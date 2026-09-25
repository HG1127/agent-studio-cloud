import { describe, expect, it } from "vitest";
import { FatalError, RetryableError } from "workflow";
import { safeWorkflowFailureReason, withSafeWorkflowError } from "@/server/security/workflow-error";

describe("工作流安全异常边界", () => {
  it("返回成功结果并保留显式工作流错误", async () => {
    await expect(withSafeWorkflowError(async () => "ok", "保存失败")).resolves.toBe("ok");
    const fatal = new FatalError("业务规则不允许继续");
    await expect(withSafeWorkflowError(async () => { throw fatal; }, "保存失败")).rejects.toBe(fatal);
    const retryable = new RetryableError("稍后重试", { retryAfter: "5s" });
    await expect(withSafeWorkflowError(async () => { throw retryable; }, "保存失败")).rejects.toBe(retryable);
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

  it("只展示显式工作流错误，未知异常即使含中文也使用兜底文案", () => {
    const queryError = new Error("Failed query: insert into runs\nparams: 客户机密内容");
    expect(safeWorkflowFailureReason(queryError, "运行失败")).toBe("运行失败");
    expect(safeWorkflowFailureReason(new FatalError("业务失败，令牌：private-token-value"), "运行失败"))
      .toBe("业务失败，[已隐藏敏感信息]");
    expect(safeWorkflowFailureReason(new RetryableError("服务繁忙，请稍后重试", { retryAfter: "2s" }), "运行失败"))
      .toBe("服务繁忙，请稍后重试");
  });
});
