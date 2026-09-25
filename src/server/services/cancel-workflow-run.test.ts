import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  isNotFound: vi.fn(),
}));

vi.mock("workflow/api", () => ({ getRun: () => ({ cancel: mocks.cancel }) }));
vi.mock("workflow/errors", () => ({ WorkflowRunNotFoundError: { is: mocks.isNotFound } }));

import { cancelWorkflowRunIfPresent } from "@/server/services/cancel-workflow-run";

beforeEach(() => {
  mocks.cancel.mockReset().mockResolvedValue(undefined);
  mocks.isNotFound.mockReset().mockReturnValue(false);
});

describe("取消工作流句柄", () => {
  it("正常取消时返回已取消", async () => {
    await expect(cancelWorkflowRunIfPresent("workflow-1")).resolves.toBe("cancelled");
  });

  it("平台明确确认句柄不存在时允许继续清理数据库状态", async () => {
    const error = new Error("not found");
    mocks.cancel.mockRejectedValue(error);
    mocks.isNotFound.mockImplementation((value) => value === error);

    await expect(cancelWorkflowRunIfPresent("workflow-missing")).resolves.toBe("missing");
  });

  it("临时平台错误仍向上抛出，避免工作流继续执行时误写取消终态", async () => {
    const error = new Error("service unavailable");
    mocks.cancel.mockRejectedValue(error);

    await expect(cancelWorkflowRunIfPresent("workflow-1")).rejects.toBe(error);
  });
});
