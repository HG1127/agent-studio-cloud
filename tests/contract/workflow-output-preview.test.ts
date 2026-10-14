import { describe, expect, it, vi } from "vitest";
import { MAX_OUTPUT_PREVIEW_BODY_BYTES, MAX_OUTPUT_PREVIEW_RESULT_BYTES, MAX_OUTPUT_PREVIEW_SAMPLES_BYTES, WorkflowOutputPreviewInput, WorkflowOutputPreviewResult } from "@/contracts/workflow-output-preview";
import { outputPreviewWorkflow } from "../fixtures/domain/workflow-output-preview";

const success = { ok: true, executed: false, scope: "final-delivery-fields", result: { amount: 0, approved: false }, fields: [{ path: "amount", status: "provided" }] };
describe("最终交付试算共享契约", () => {
  it("仅接受完整流程和显式样例，未填写样例为空", () => {
    const workflow = outputPreviewWorkflow();
    expect(WorkflowOutputPreviewInput.parse({ workflow })).toEqual({ workflow, outputs: {} });
    expect(WorkflowOutputPreviewInput.safeParse({ outputs: {} }).success).toBe(false);
  });
  it.each(["runId", "workspaceId", "manifest", "inlineReferences", "fields", "execute"])("不能注入执行或内部来源配置 %s", (key) => {
    expect(WorkflowOutputPreviewInput.safeParse({ workflow: outputPreviewWorkflow(), [key]: {} }).success).toBe(false);
  });
  it("回执保留业务值与未执行范围，失败不能携带半成品或原始样例", () => {
    expect(WorkflowOutputPreviewResult.parse(success)).toEqual(success);
    const failed = { ok: false, executed: false, scope: "final-delivery-fields", code: "missing_source", error: "请补充样例", fields: [{ path: "amount", status: "missing" }] };
    expect(WorkflowOutputPreviewResult.parse(failed)).toEqual(failed);
    for (const extra of [{ result: {} }, { outputs: {} }, { workflow: {} }]) expect(WorkflowOutputPreviewResult.safeParse({ ...failed, ...extra }).success).toBe(false);
  });
  it.each([
    { ...success, executed: true }, { ...success, scope: "workflow" }, { ...success, outputs: {} },
    { ...success, fields: [{ path: "amount", status: "missing" }] }, { ...success, fields: [{ path: "amount", status: "invalid" }] },
    { ...success, fields: Array.from({ length: 101 }, () => ({ path: "amount", status: "provided" })) },
  ])("误称执行、范围、成功或超出字段数的回执拒绝 %#", (raw) => {
    expect(WorkflowOutputPreviewResult.safeParse(raw).success).toBe(false);
  });
  it("样例和整个请求分别按 UTF-8 字节限制", () => {
    expect(WorkflowOutputPreviewInput.safeParse({ workflow: outputPreviewWorkflow(), outputs: { extract: "中".repeat(Math.ceil(MAX_OUTPUT_PREVIEW_SAMPLES_BYTES / 3)) } }).success).toBe(false);
    const workflow = { ...outputPreviewWorkflow(), businessRequirements: { notes: "中".repeat(Math.ceil(MAX_OUTPUT_PREVIEW_BODY_BYTES / 3)) } };
    expect(WorkflowOutputPreviewInput.safeParse({ workflow }).success).toBe(false);
  });
  it("响应限制包括诊断元数据，不只计算成果正文", () => {
    const result = { ...success, result: { content: "x".repeat(MAX_OUTPUT_PREVIEW_RESULT_BYTES - 30) } };
    expect(new TextEncoder().encode(JSON.stringify(result.result)).byteLength).toBeLessThan(MAX_OUTPUT_PREVIEW_RESULT_BYTES);
    expect(WorkflowOutputPreviewResult.safeParse(result).success).toBe(false);
  });
  it("直接对象、数组访问器与序列化函数在取值前拒绝", () => {
    const getter = vi.fn(() => 0), toJSON = vi.fn(() => ({}));
    const value = Object.defineProperty({}, "amount", { enumerable: true, get: getter });
    const rows = Object.defineProperty([0], "0", { enumerable: true, get: getter });
    for (const extract of [value, { rows }, { toJSON }]) expect(WorkflowOutputPreviewInput.safeParse({ workflow: outputPreviewWorkflow(), outputs: { extract } }).success).toBe(false);
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
});
