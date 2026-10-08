import { beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";

const mocks = vi.hoisted(() => ({ select: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: vi.fn() }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: vi.fn() }));

import { readRecordedApprovalDecision } from "./approval-step";

const args = { runId: "run-1", approvalId: "approval-1" };

beforeEach(() => {
  vi.resetAllMocks();
  const query = {
    from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: mocks.limit,
  };
  mocks.select.mockReturnValue(query);
});

describe("读取已保存的审批决定", () => {
  it.each(["approved", "rejected"] as const)("读取 %s 的持久化决定与意见", async (decision) => {
    mocks.limit.mockResolvedValue([{ status: decision, note: "保存的意见" }]);
    await expect(readRecordedApprovalDecision(args)).resolves.toEqual({ decision, note: "保存的意见" });
  });

  it("未确认时返回空值，保留通过 Hook 等待的路径", async () => {
    mocks.limit.mockResolvedValue([{ status: "pending", note: null }]);
    await expect(readRecordedApprovalDecision(args)).resolves.toBeNull();
  });

  it("没有意见时不伪造空字符串", async () => {
    mocks.limit.mockResolvedValue([{ status: "approved", note: null }]);
    await expect(readRecordedApprovalDecision(args)).resolves.toEqual({ decision: "approved" });
  });

  it.each([{ rows: [] }, { rows: [{ status: "invalid", note: null }] }])("丢失或损坏的确认记录是永久失败", async ({ rows }) => {
    mocks.limit.mockResolvedValue(rows);
    const error = await readRecordedApprovalDecision(args).catch((failure) => failure);
    expect(FatalError.is(error)).toBe(true);
  });

  it("数据库暂时不可用时安全重试，不泄漏底层错误", async () => {
    mocks.limit.mockRejectedValue(new Error("postgres password=customer-secret-value"));
    const error = await readRecordedApprovalDecision(args).catch((failure) => failure);
    expect(RetryableError.is(error)).toBe(true);
    expect(error.message).toBe("确认决定暂时无法读取，请稍后重试");
  });
});
