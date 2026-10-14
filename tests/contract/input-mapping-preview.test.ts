import { describe, expect, it } from "vitest";
import { InputMappingPreviewInput, InputMappingPreviewResult, MAX_INPUT_PREVIEW_BODY_BYTES } from "@/contracts/input-mapping-preview";

const success = { ok: true, executed: false, scope: "field-mapping", input: { amount: 0, approved: false }, outputs: {}, includesUpstreamOutputs: false, fields: [{ target: ["amount"], status: "provided" }] };
describe("字段试算共享契约", () => {
  it("请求明确需要映射，样例默认为空且不接受其他执行配置", () => {
    expect(InputMappingPreviewInput.parse({ mapping: {} })).toEqual({ mapping: { fields: [], includeUpstreamOutputs: false }, input: {}, outputs: {} });
    expect(InputMappingPreviewInput.safeParse({ input: {} }).success).toBe(false);
    expect(InputMappingPreviewInput.safeParse({ mapping: {}, node: { type: "tool" } }).success).toBe(false);
  });
  it("完整保留业务值与明确未执行范围，失败不附带原始数据", () => {
    expect(InputMappingPreviewResult.parse(success)).toEqual(success);
    const failed = { ok: false, executed: false, scope: "field-mapping", code: "missing_source", error: "请补充样例", fields: [{ target: ["amount"], status: "missing" }] };
    expect(InputMappingPreviewResult.parse(failed)).toEqual(failed);
    expect(InputMappingPreviewResult.safeParse({ ...failed, input: { secret: "原始正文" } }).success).toBe(false);
  });
  it.each([
    { ...success, executed: true }, { ...success, scope: "workflow" },
    { ...success, fields: [{ target: ["amount"], status: "missing" }] },
    { ...success, outputs: { hidden: { text: "不应附带" } } },
    { ...success, result: "误称真实任务完成" },
  ])("误称执行、范围、缺失或额外成果的回执不能通过 %#", (raw) => {
    expect(InputMappingPreviewResult.safeParse(raw).success).toBe(false);
  });
  it("整体请求按 UTF-8 字节有界，不让多个合法固定值绕过总容量", () => {
    const fields = Array.from({ length: 10 }, (_, index) => ({ target: [`field${index}`], source: { kind: "literal", value: "中".repeat(20_000) } }));
    const request = { mapping: { fields } };
    expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeGreaterThan(MAX_INPUT_PREVIEW_BODY_BYTES);
    expect(InputMappingPreviewInput.safeParse(request).success).toBe(false);
  });
  it("直接校验对象不能读取访问器，将可执行取值冒充 JSON 样例", () => {
    let reads = 0;
    const input = Object.defineProperty({}, "amount", { enumerable: true, get() { reads += 1; return 0; } });
    expect(InputMappingPreviewInput.safeParse({ mapping: {}, input }).success).toBe(false);
    expect(reads).toBe(0);
  });
  it("序列化函数不是样例值，不为检查容量调用它", () => {
    let calls = 0;
    const input = { amount: 0, toJSON() { calls += 1; return { amount: 0 }; } };
    expect(InputMappingPreviewInput.safeParse({ mapping: {}, input }).success).toBe(false);
    expect(calls).toBe(0);
  });
  it("数组元素访问器在读取之前拒绝", () => {
    let reads = 0;
    const rows = Object.defineProperty([0], "0", { enumerable: true, get() { reads += 1; return 0; } });
    expect(InputMappingPreviewInput.safeParse({ mapping: {}, outputs: { step: { rows } } }).success).toBe(false);
    expect(reads).toBe(0);
  });
});
