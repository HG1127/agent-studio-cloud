import { describe, expect, it, vi } from "vitest";
import { InputMappingPreviewResult, MAX_INPUT_PREVIEW_OUTPUTS_BYTES } from "@/contracts/input-mapping-preview";
import { MAX_RUN_INPUT_BYTES } from "@/contracts/run";
import { resolveInputMappingPreview } from "@/server/domain/runtime/input-mapping-preview";
import { resolveNodeInput } from "@/server/domain/runtime/input-mapping";
import { InputMapping } from "@/contracts/input-mapping";

vi.mock("@/lib/db", () => { throw new Error("字段试算不能导入数据库"); });
vi.mock("workflow/api", () => { throw new Error("字段试算不能导入运行启动器"); });

const fields = [
  { target: ["order", "amount"], source: { kind: "output", nodeId: "group.extract", path: ["rows", "0", "amount"] } },
  { target: ["order", "approved"], source: { kind: "input", path: ["approved"] } },
  { target: ["customer", "id"], source: { kind: "output", nodeId: "group.extract", path: ["customer.id"] } },
  { target: ["note"], source: { kind: "input", path: ["note"] }, fallback: "待补充" },
  { target: ["optional"], source: { kind: "input", path: ["optional"] }, required: false },
  { target: ["channel"], source: { kind: "literal", value: "售后" } },
];
const example = { mapping: { fields }, input: { approved: false }, outputs: { "group.extract": { rows: [{ amount: 0 }], "customer.id": "00123" }, other: { apiKey: "unselected-private-key" } } };

describe("无副作用字段映射试算", () => {
  it("试算与运行时共享解析保持一致，业务零值、否定、编号、嵌套和兜底不改变", () => {
    const before = JSON.stringify(example), parsedMapping = InputMapping.parse(example.mapping);
    const runtime = resolveNodeInput({ node: { title: "试算", inputMapping: parsedMapping }, input: example.input, outputs: example.outputs });
    const result = resolveInputMappingPreview(example);
    expect(result).toMatchObject({ ok: true, executed: false, scope: "field-mapping", input: { order: { amount: 0, approved: false }, customer: { id: "00123" }, note: "待补充", channel: "售后" }, outputs: {}, includesUpstreamOutputs: false });
    if (!result.ok || !runtime.ok) throw new Error("试算应成功");
    expect(result.input).toEqual(runtime.input); expect(result.outputs).toEqual(runtime.outputs);
    expect(result.fields.map((field) => field.status)).toEqual(["provided", "provided", "provided", "fallback", "omitted", "provided"]);
    expect(JSON.stringify(result)).not.toContain("unselected-private-key");
    expect(JSON.stringify(example)).toBe(before); expect(InputMappingPreviewResult.parse(result)).toEqual(result);
  });

  it.each([null, 0, false, ""])("显式值 %s 不触发缺失兜底", (value) => {
    const result = resolveInputMappingPreview({ mapping: { fields: [{ target: ["value"], source: { kind: "input", path: ["value"] }, fallback: "替代" }] }, input: { value } });
    expect(result).toMatchObject({ ok: true, input: { value }, fields: [{ target: ["value"], status: "provided" }] });
  });

  it("诊断全部缺失字段但不返回半成品输入或原始正文", () => {
    const result = resolveInputMappingPreview({ ...example, input: { note: "内部正文" }, outputs: {} });
    expect(result).toMatchObject({ ok: false, code: "missing_source", executed: false });
    expect(result.fields.map((field) => field.status)).toEqual(["missing", "missing", "missing", "provided", "omitted", "provided"]);
    expect(result).not.toHaveProperty("input"); expect(JSON.stringify(result)).not.toContain("内部正文");
  });

  it("整份上游仅在显式开启后展示，副本不会修改样例数据", () => {
    const raw = { mapping: { fields: [], includeUpstreamOutputs: true }, outputs: { step: { amount: 0 } } };
    const result = resolveInputMappingPreview(raw);
    expect(result).toMatchObject({ ok: true, input: {}, includesUpstreamOutputs: true, outputs: raw.outputs });
    if (!result.ok) throw new Error("试算应成功");
    (result.outputs.step as { amount: number }).amount = 9;
    expect(raw.outputs.step.amount).toBe(0);
  });

  it.each(["apiKey", "authorization", "password"])("映射结果凭据字段 %s 不会返回", (key) => {
    const result = resolveInputMappingPreview({ mapping: { fields: [{ target: [key], source: { kind: "input", path: ["value"] } }] }, input: { value: "selected-private-key" } });
    expect(result).toMatchObject({ ok: false, code: "unsafe_data" }); expect(JSON.stringify(result)).not.toContain("selected-private-key");
  });

  it.each([
    { mapping: { fields: [{ target: ["value"], source: { kind: "literal", value: "Bearer literal-private-key" } }] } },
    { mapping: { fields: [{ target: ["value"], source: { kind: "input", path: ["value"] }, fallback: "Bearer fallback-private-key" }] }, input: { value: "业务问题" } },
    { mapping: { fields: [], includeUpstreamOutputs: true }, outputs: { step: { apiKey: "whole-private-key" } } },
  ])("固定值、未用兜底或全量成果中的凭据均拒绝，不悄悄脱敏 %#", (raw) => {
    const result = resolveInputMappingPreview(raw); expect(result).toMatchObject({ ok: false, code: "unsafe_data" });
    expect(JSON.stringify(result)).not.toMatch(/literal-private-key|fallback-private-key|whole-private-key/);
  });

  it("普通业务邮箱与金额不按凭据删除", () => {
    expect(resolveInputMappingPreview({ mapping: { fields: [{ target: ["customer"], source: { kind: "input", path: ["customer"] } }] }, input: { customer: { email: "customer@example.com", amount: 0 } } })).toMatchObject({ ok: true, input: { customer: { email: "customer@example.com", amount: 0 } } });
  });

  it("200 字符完整步骤标识按整体读取，不拆点号", () => {
    const nodeId = "batch.branch." + "x".repeat(187);
    expect(nodeId).toHaveLength(200);
    expect(resolveInputMappingPreview({ mapping: { fields: [{ target: ["topic"], source: { kind: "output", nodeId, path: ["topic"] } }] }, outputs: { [nodeId]: { topic: "退货政策" } } })).toMatchObject({ ok: true, input: { topic: "退货政策" } });
  });

  it("映射后超过实际运行容量时失败，不把各字段可读等同成功", () => {
    const content = "x".repeat(Math.ceil(MAX_RUN_INPUT_BYTES / 2));
    const result = resolveInputMappingPreview({ mapping: { fields: ["a", "b"].map((key) => ({ target: [key], source: { kind: "output", nodeId: "step", path: ["content"] } })) }, outputs: { step: { content } } });
    expect(result).toMatchObject({ ok: false, code: "invalid_mapping_data", fields: [{ status: "provided" }, { status: "provided" }] });
    expect(result).not.toHaveProperty("input");
  });

  it.each([
    { mapping: { fields: [{ target: ["__proto__"], source: { kind: "literal", value: "污染" } }] } },
    { mapping: { fields: [{ target: ["a"], source: { kind: "literal", value: 1 } }, { target: ["a", "b"], source: { kind: "literal", value: 2 } }] } },
    { mapping: { fields: [] }, outputs: { step: { text: "x".repeat(MAX_INPUT_PREVIEW_OUTPUTS_BYTES) } } },
    { mapping: { fields: [] }, input: { bad: Infinity } },
    { mapping: { fields: [] }, workspaceId: "不应接受" },
  ])("无效请求或污染配置不能试算 %#", (raw) => {
    expect(resolveInputMappingPreview(raw)).toMatchObject({ ok: false, code: "invalid_request", fields: [] });
  });

  it("空映射只得到空输入，不隐式替换原任务", () => {
    expect(resolveInputMappingPreview({ mapping: { fields: [] }, input: { task: "原任务" }, outputs: { step: { text: "上游" } } })).toMatchObject({ ok: true, input: {}, outputs: {}, fields: [] });
  });
  it("直接试算拒绝可执行访问器，不调用它获取样例字段", () => {
    const read = vi.fn(() => "业务主题");
    const outputs = { step: Object.defineProperty({}, "topic", { enumerable: true, get: read }) };
    expect(resolveInputMappingPreview({ mapping: { fields: [{ target: ["topic"], source: { kind: "output", nodeId: "step", path: ["topic"] } }] }, outputs })).toMatchObject({ ok: false, code: "invalid_request" });
    expect(read).not.toHaveBeenCalled();
  });
  it("拒绝循环和非 JSON 对象，但合法重复引用可按 JSON 值试算", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(resolveInputMappingPreview({ mapping: {}, outputs: cycle })).toMatchObject({ ok: false, code: "invalid_request" });
    expect(resolveInputMappingPreview({ mapping: {}, outputs: { step: new Date() } })).toMatchObject({ ok: false, code: "invalid_request" });
    const shared = Object.freeze({ topic: "退货政策" });
    const mapping = { fields: [{ target: ["topic"], source: { kind: "output", nodeId: "first", path: ["topic"] } }] };
    expect(resolveInputMappingPreview({ mapping, outputs: { first: shared, second: shared } })).toMatchObject({ ok: true, input: { topic: "退货政策" } });
  });
});
