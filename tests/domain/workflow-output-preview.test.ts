import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { MAX_OUTPUT_PREVIEW_SAMPLES_BYTES, WorkflowOutputPreviewResult } from "@/contracts/workflow-output-preview";
import { projectWorkflowResult, resolveWorkflowOutputValue } from "@/server/domain/runtime/output-contract";
import { resolveWorkflowOutputPreview } from "@/server/domain/runtime/workflow-output-preview";
import { getWorkflowOutputPreview } from "@/server/queries/workflow-output-preview";
import { outputPreviewRequest, outputPreviewWorkflow } from "../fixtures/domain/workflow-output-preview";

vi.mock("@/lib/db", () => { throw new Error("交付试算不能导入数据库"); });
vi.mock("workflow/api", () => { throw new Error("交付试算不能导入执行启动器"); });
vi.mock("ai", () => { throw new Error("交付试算不能导入模型调用器"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const select = (sourceNodeId = "extract", sourcePath: string[] = ["rows", "0", "amount"], required = true) => ({ path: "交付", sourceNodeId, sourcePath, required });

describe("无副作用最终交付字段试算", () => {
  it("与实际成果计算一致，组合业务字段并保留零、否定值和邮箱", () => {
    const raw = outputPreviewRequest();
    raw.workflow = outputPreviewWorkflow([
      select(), { ...select("extract", ["rows", "0", "approved"]), path: "批准" }, { ...select("extract", ["rows", "0", "email"]), path: "邮箱" },
    ]);
    const result = resolveWorkflowOutputPreview(raw);
    expect(WorkflowOutputPreviewResult.parse(result)).toMatchObject({ ok: true, executed: false, scope: "final-delivery-fields", result: { 交付: 0, 批准: false, 邮箱: "business@example.com" }, fields: Array(3).fill({ status: "provided" }) });
    const projected = projectWorkflowResult(raw.outputs, raw.workflow.outputContract!.fields);
    expect(result.ok && projected.ok && result.result).toEqual(projected.ok && projected.result);
  });
  it("试算和查询不变更配置或样例、不使用网络", async () => {
    const raw = outputPreviewRequest(), before = JSON.stringify(raw), network = vi.fn(() => { throw new Error("禁止网络"); });
    vi.stubGlobal("fetch", network);
    expect(await getWorkflowOutputPreview(raw)).toMatchObject({ ok: true });
    expect(JSON.stringify(raw)).toBe(before); expect(network).not.toHaveBeenCalled();
  });
  it.each([undefined, { fields: [] }])("未配置字段沿用原始成果，但响应是独立副本 %#", (outputContract) => {
    const workflow = outputPreviewWorkflow();
    if (outputContract) workflow.outputContract = outputContract; else delete workflow.outputContract;
    const outputs = { extract: { rows: [{ amount: 0 }] } }, result = resolveWorkflowOutputPreview({ workflow, outputs });
    expect(result).toMatchObject({ ok: true, result: outputs, fields: [] });
    if (!result.ok) throw new Error("应成功");
    expect(result.result).not.toBe(outputs); expect(result.result.extract).not.toBe(outputs.extract);
  });
  it("未配置来源路径仍交付整个步骤，空路径行为相同", () => {
    for (const sourcePath of [undefined, []]) {
      const field = { path: "交付", sourceNodeId: "extract", required: true, ...(sourcePath ? { sourcePath } : {}) };
      expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([field]), outputs: { extract: { amount: 0 } } })).toMatchObject({ ok: true, result: { 交付: { amount: 0 } } });
    }
  });
  it("旧路径交付和含点对象键按运行规则读取", () => {
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([{ path: "extract.amount", required: true }]), outputs: { extract: { amount: 0 } } })).toMatchObject({ ok: true, result: { extract: { amount: 0 } } });
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select("extract", ["01", "a.b"])]), outputs: { extract: { "01": { "a.b": false } } } })).toMatchObject({ ok: true, result: { 交付: false } });
  });
  it("完整诊断所有必填缺失和可选省略，不返回半成品", () => {
    const workflow = outputPreviewWorkflow([
      select(), { ...select("extract", ["missing"]), path: "缺失一" }, { ...select("extract", ["other"]), path: "缺失二" }, { ...select("extract", ["optional"], false), path: "可选" },
    ]);
    const result = resolveWorkflowOutputPreview({ ...outputPreviewRequest(), workflow });
    expect(result).toMatchObject({ ok: false, code: "missing_source", fields: [
      { path: "交付", status: "provided" }, { path: "缺失一", status: "missing" }, { path: "缺失二", status: "missing" }, { path: "可选", status: "omitted" },
    ] });
    expect(result).not.toHaveProperty("result"); expect(result).not.toHaveProperty("outputs");
  });
  it.each([null, "   ", {}, []])("空业务成果不能虚报交付 %#", (value) => {
    for (const required of [true, false]) expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select("extract", ["value"], required)]), outputs: { extract: { value } } }))
      .toMatchObject(required ? { ok: false, code: "missing_source", fields: [{ status: "missing" }] } : { ok: true, result: {}, fields: [{ status: "omitted" }] });
  });
  it("从完成子流程原生汇总读取内部成果，无需手写数组路径", () => {
    const outputs = { group: { status: "completed", steps: [{ output: { rows: [{ amount: 0 }] } }] } };
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select("group.extract")]), outputs })).toMatchObject({ ok: true, result: { 交付: 0 } });
  });
  it.each(["running", "failed", "pending"])("未完成子流程 %s 不能读取内部成果", (status) => {
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select("group.extract")]), outputs: { group: { status, steps: [{ output: { rows: [{ amount: 0 }] } }] } } })).toMatchObject({ ok: false, code: "missing_source" });
  });
  it("部分失败并行可以选成功分支，失败分支不能借用成果", () => {
    const outputs = { batch: { status: "completed_with_issues", branches: {
      work: { status: "completed", outputs: { "batch.work.extract": { rows: [{ amount: 0 }] } } },
      other: { status: "failed", outputs: { "batch.other.extract": { rows: [{ amount: 999 }] } } },
    } } };
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select("batch.work.extract")]), outputs })).toMatchObject({ ok: true, result: { 交付: 0 } });
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select("batch.other.extract")]), outputs })).toMatchObject({ ok: false, code: "missing_source" });
    outputs.batch.status = "running";
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select("batch.work.extract")]), outputs })).toMatchObject({ ok: false, code: "missing_source" });
  });
  it("明确为空的平铺成果不回退旧容器汇总", () => {
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select("group.extract")]), outputs: { "group.extract": null, group: { status: "completed", steps: [{ output: { rows: [{ amount: 0 }] } }] } } })).toMatchObject({ ok: false, code: "missing_source" });
  });
  it.each([{ status: "failed", rows: [{ amount: 0 }] }, { ok: false, rows: [{ amount: 0 }] }])("失败回执不能冒充成功来源 %#", (extract) => {
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select()]), outputs: { extract } })).toMatchObject({ ok: false, code: "missing_source" });
  });
  it.each(["01", "-1", "length", "map", "1"])("不读取数组非法索引或元数据 %s", (index) => {
    expect(resolveWorkflowOutputPreview({ ...outputPreviewRequest(), workflow: outputPreviewWorkflow([select("extract", ["rows", index, "amount"])]) })).toMatchObject({ ok: false, code: "missing_source" });
  });
  it.each(["start", "done", "unknown", "group.unknown"])("来源 %s 必须属于真实业务步骤，样例不能发明步骤", (source) => {
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select(source)]), outputs: { [source]: { rows: [{ amount: 0 }] } } })).toMatchObject({ ok: false, code: "invalid_source", fields: [] });
  });
  it("隐藏步骤与无效容器内部来源拒绝", () => {
    const workflow = outputPreviewWorkflow([select()]); workflow.nodes.extract.ui = { visibility: "control" };
    expect(resolveWorkflowOutputPreview({ workflow, outputs: outputPreviewRequest().outputs })).toMatchObject({ ok: false, code: "invalid_source" });
    const invalid = outputPreviewWorkflow([select("group.extract")]); invalid.nodes.group.subflow!.steps = [];
    expect(resolveWorkflowOutputPreview({ workflow: invalid, outputs: {} })).toMatchObject({ ok: false, code: "invalid_source" });
  });
  it("检查交付而不是验收整条流程，不因未连通节点偷偷执行或拒绝样例", () => {
    const workflow = outputPreviewWorkflow(); workflow.startNodeId = "not_connected"; workflow.nodes.extract.next = null;
    expect(resolveWorkflowOutputPreview({ ...outputPreviewRequest(), workflow })).toMatchObject({ ok: true, executed: false });
  });
  it.each([{ paths: ["交付", "交付"] }, { paths: ["交付", "交付.金额"] }, { paths: ["交付.0", "其他"] }])("无效或冲突目标位置明确拒绝 %#", ({ paths }) => {
    expect(resolveWorkflowOutputPreview({ ...outputPreviewRequest(), workflow: outputPreviewWorkflow(paths.map((path) => ({ ...select(), path }))) })).toMatchObject({ ok: false, code: "invalid_request", fields: [] });
  });
  it("未选凭据和未用节点的凭据定义不进入响应，也不阻止正常业务字段", () => {
    const workflow = outputPreviewWorkflow([select()]);
    workflow.nodes.extract.modelOutput = { format: "json", providerMode: "json", maxRepairAttempts: 1, schema: { type: "object", properties: { password: { type: "string" } } }, mockOutput: { password: "unselected-private-value" } };
    const result = resolveWorkflowOutputPreview({ workflow, outputs: { extract: { rows: [{ amount: 0 }], password: "unselected-private-value" }, other: { apiKey: "other-private-value" } } });
    expect(result).toMatchObject({ ok: true, result: { 交付: 0 } }); expect(JSON.stringify(result)).not.toMatch(/unselected-private-value|other-private-value|password|apiKey/);
  });
  it.each([
    { field: select("extract", ["password"], false), extract: { password: "selected-private-value" } },
    { field: select("extract", ["value"]), extract: { value: { apiKey: "selected-private-value" } } },
    { field: select("extract", ["value"]), extract: { value: "Bearer selected-private-value" } },
    { field: { ...select("extract", ["value"]), path: "secret" }, extract: { value: "selected-private-value" } },
  ])("凭据来源、重命名、选中对象和文字凭据不能展示 %#", ({ field, extract }) => {
    const result = resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([field]), outputs: { extract } });
    expect(result).toMatchObject({ ok: false, code: "unsafe_data" }); expect(JSON.stringify(result)).not.toContain("selected-private-value"); expect(result).not.toHaveProperty("result");
  });
  it("配置中的凭据文字不能通过标签或目标诊断泄露", () => {
    const workflow = outputPreviewWorkflow([{ ...select(), label: "Bearer configured-private-value" }]);
    const result = resolveWorkflowOutputPreview({ ...outputPreviewRequest(), workflow });
    expect(result).toMatchObject({ ok: false, code: "unsafe_data", fields: [] }); expect(JSON.stringify(result)).not.toContain("configured-private-value");
  });
  it("未配置字段意味着全量交付，其中凭据不能默认展示", () => {
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([]), outputs: { extract: { password: "whole-private-value" } } })).toMatchObject({ ok: false, code: "unsafe_data" });
  });
  it("用量字段不误判凭据，复制嵌套业务对象不改原值", () => {
    const outputs = { extract: { totalTokens: 0, email: "business@example.com", approved: false } };
    const result = resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select("extract", [])]), outputs });
    expect(result).toMatchObject({ ok: true, result: { 交付: outputs.extract } });
    if (!result.ok) throw new Error("应成功");
    (result.result.交付 as Record<string, unknown>).approved = true; expect(outputs.extract.approved).toBe(false);
  });
  it("单一样例符合容量但重复组合超过运行容量时失败，全部字段诊断不冒充成功", () => {
    const workflow = outputPreviewWorkflow(Array.from({ length: 20 }, (_, index) => ({ ...select("extract", ["content"]), path: `字段${index}` })));
    const result = resolveWorkflowOutputPreview({ workflow, outputs: { extract: { content: "x".repeat(120_000) } } });
    expect(result).toMatchObject({ ok: false, code: "invalid_result" }); expect(result.fields).toHaveLength(20); expect(result.fields.every((field) => field.status === "provided")).toBe(true); expect(result).not.toHaveProperty("result");
  });
  it("组合满足运行限制但超过试算响应限制仍明确失败、不截断", () => {
    const workflow = outputPreviewWorkflow([0, 1, 2].map((index) => ({ ...select("extract", ["content"]), path: `字段${index}` })));
    expect(resolveWorkflowOutputPreview({ workflow, outputs: { extract: { content: "x".repeat(200_000) } } })).toMatchObject({ ok: false, code: "invalid_result" });
  });
  it("目标深度使组合超过 JSON 限制时失败，不把单字段取值成功当作整体成功", () => {
    const workflow = outputPreviewWorkflow([{ ...select("extract", ["amount"]), path: Array(33).fill("层").join(".") }]);
    expect(resolveWorkflowOutputPreview({ workflow, outputs: { extract: { amount: 0 } } })).toMatchObject({ ok: false, code: "invalid_result", fields: [{ status: "provided" }] });
  });
  it("样例超过容量、含访问器或可执行转换时拒绝，且不调用它们", () => {
    const getter = vi.fn(() => 0), toJSON = vi.fn(() => ({}));
    const value = Object.defineProperty({}, "amount", { enumerable: true, get: getter });
    for (const extract of [value, { toJSON }, "x".repeat(MAX_OUTPUT_PREVIEW_SAMPLES_BYTES)]) expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow(), outputs: { extract } })).toMatchObject({ ok: false, code: "invalid_request", fields: [] });
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it("嵌套循环与非 JSON 值拒绝，安全无环共享值可用", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [cycle, Infinity, new Date(), undefined]) expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select("extract", ["value"])]), outputs: { extract: { value } } })).toMatchObject({ ok: false, code: "invalid_request" });
    const shared = Object.freeze({ amount: 0 });
    expect(resolveWorkflowOutputPreview({ workflow: outputPreviewWorkflow([select("extract", ["value"])]), outputs: { extract: { value: [shared, shared] } } })).toMatchObject({ ok: true, result: { 交付: [{ amount: 0 }, { amount: 0 }] } });
  });
});

describe("真实执行和试算共用的单字段解析", () => {
  it.each([0, false, "业务编号", { amount: 0 }, [0]])("可用业务值 %# 提供给实际组合器", (value) => {
    expect(resolveWorkflowOutputValue({ extract: { value } }, select("extract", ["value"]))).toEqual({ status: "provided", value });
  });
  it("缺失、空内容和非法值有独立状态，非法值即使可选也不能省略", () => {
    expect(resolveWorkflowOutputValue({}, select())).toEqual({ status: "missing" });
    expect(resolveWorkflowOutputValue({ extract: { value: [] } }, select("extract", ["value"]))).toEqual({ status: "missing" });
    expect(resolveWorkflowOutputValue({ extract: { value: Infinity } }, select("extract", ["value"], false))).toEqual({ status: "invalid" });
    expect(resolveWorkflowOutputValue({ extract: { password: "x" } }, select("extract", ["password"]))).toEqual({ status: "invalid" });
  });
  it("解析器不读取访问器或执行 toJSON", () => {
    const getter = vi.fn(() => 0), toJSON = vi.fn(() => ({}));
    const value = Object.defineProperty({}, "amount", { enumerable: true, get: getter });
    expect(resolveWorkflowOutputValue({ extract: { value } }, select("extract", ["value"]))).toEqual({ status: "invalid" });
    expect(resolveWorkflowOutputValue({ extract: { value: { toJSON } } }, select("extract", ["value"]))).toEqual({ status: "invalid" });
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it("字段配置无效不抛异常或猜测新的来源", () => {
    expect(resolveWorkflowOutputValue({}, { path: "交付", required: true, sourcePath: ["value"] })).toEqual({ status: "invalid" });
    expect(WorkflowDraft.safeParse({ ...outputPreviewWorkflow(), outputContract: { fields: [{ path: "交付", sourcePath: ["value"] }] } }).success).toBe(false);
  });
});
