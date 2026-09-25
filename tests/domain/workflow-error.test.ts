import { describe, expect, it } from "vitest";
import { FatalError, RetryableError } from "workflow";
import { withSafeWorkflowError } from "@/server/security/workflow-error";

describe("工作流安全异常边界", () => {
  it("返回成功结果并保留显式工作流错误", async () => {
    await expect(withSafeWorkflowError(async () => "ok", "保存失败")).resolves.toBe("ok");
    const fatal = new FatalError("业务规则不允许继续");
    await expect(withSafeWorkflowError(async () => { throw fatal; }, "保存失败")).rejects.toBe(fatal);
  });

  it("把可能携带业务参数的原始异常替换成无 cause 的安全错误", async () => {
    const unsafe = new Error("insert params: customer-secret-value");
    let caught: unknown;
    try {
      await withSafeWorkflowError(async () => { throw unsafe; }, "暂时无法保存运行数据");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RetryableError);
    expect(caught).toMatchObject({ message: "暂时无法保存运行数据" });
    expect(JSON.stringify(caught)).not.toContain("customer-secret-value");
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});
