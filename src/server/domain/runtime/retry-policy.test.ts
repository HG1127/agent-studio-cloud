import { describe, expect, it } from "vitest";
import { canRetryStep, MAX_STEP_ATTEMPTS, resolveToolRetryPolicy } from "@/server/domain/runtime/retry-policy";

describe("步骤重试策略", () => {
  it("沿用工具配置的总尝试次数并提供默认退避", () => {
    expect(resolveToolRetryPolicy({ tool: { maxRetries: 3 } })).toEqual({ maxAttempts: 3, backoffMs: 5_000 });
    expect(canRetryStep(1, 3)).toBe(true);
    expect(canRetryStep(2, 3)).toBe(true);
    expect(canRetryStep(3, 3)).toBe(false);
  });

  it("节点级策略优先并限制在运行时安全范围内", () => {
    expect(resolveToolRetryPolicy({
      retry: { maxAttempts: 5, backoffMs: 750 },
      tool: { maxRetries: 2 },
    })).toEqual({ maxAttempts: 5, backoffMs: 750 });
    expect(resolveToolRetryPolicy({
      retry: { maxAttempts: 99, backoffMs: 1 },
      tool: { maxRetries: 99 },
    })).toEqual({ maxAttempts: MAX_STEP_ATTEMPTS, backoffMs: 50 });
  });

  it("缺少配置时只执行一次", () => {
    expect(resolveToolRetryPolicy({})).toEqual({ maxAttempts: 1, backoffMs: 5_000 });
    expect(canRetryStep(1, 1)).toBe(false);
  });
});
