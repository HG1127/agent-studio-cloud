// 归一化说明：管道测试不做金测逐字节对齐（Task 4-7 金测已各自覆盖），只断言管道产物满足契约。
// 容错路径用 vi.mock 把 compileIntentWorkflow 换成一次性抛错实现（控制方裁定 2：链上异常不得
// 穿透到 UI）；mock 默认透传真实编译器，首个用例跑的仍是完整真实管道。
import { describe, expect, it, vi } from "vitest";
import golden1 from "../fixtures/domain/intent-golden-1.json";
import { WorkflowDraft } from "@/contracts/workflow";
import { buildAgentDraft } from "@/server/domain/pipeline";

const mocks = vi.hoisted(() => ({ compileIntentWorkflow: vi.fn() }));

vi.mock("@/server/domain/intent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/domain/intent")>();
  mocks.compileIntentWorkflow.mockImplementation(actual.compileIntentWorkflow);
  return { ...actual, compileIntentWorkflow: mocks.compileIntentWorkflow };
});

describe("创建助手管道 buildAgentDraft", () => {
  it("intent-golden-1 文本：草稿含业务落地、审计摘要与 issues 数组，且通过草稿契约校验", () => {
    const result = buildAgentDraft({ name: golden1.input.name, intentText: golden1.input.text });
    expect(result.draft).not.toBeNull();
    expect(result.draft?.businessGrounding).toBeTruthy();
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.diagnostics.error).toBeUndefined();
    expect(result.diagnostics.audit).toMatchObject({ status: "blocked", counts: { critical: 3 } });
    expect(() => WorkflowDraft.parse(result.draft)).not.toThrow();
  });

  it("链上抛错时不穿透异常：草稿为空、issues 为空数组、诊断带错误信息", () => {
    mocks.compileIntentWorkflow.mockImplementationOnce(() => {
      throw new Error("模拟解析失败");
    });
    const result = buildAgentDraft({ name: golden1.input.name, intentText: golden1.input.text });
    expect(result.draft).toBeNull();
    expect(result.issues).toEqual([]);
    expect(result.diagnostics.error).toBe("模拟解析失败");
    expect(result.diagnostics.audit).toBeUndefined();
  });
});
