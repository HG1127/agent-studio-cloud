import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startRunCore: vi.fn(),
  resumeQueuedRunStartCore: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/server/services/start-run-core", () => ({
  startRunCore: mocks.startRunCore,
  resumeQueuedRunStartCore: mocks.resumeQueuedRunStartCore,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { startRunAction } from "@/server/actions/start-run";
import { resumeRunStartAction } from "@/server/actions/resume-run-start";

const AGENT_ID = "00000000-0000-4000-8000-000000000071";
const RUN_ID = "00000000-0000-4000-8000-000000000072";

beforeEach(() => {
  mocks.startRunCore.mockReset().mockResolvedValue({ ok: true, runId: RUN_ID });
  mocks.resumeQueuedRunStartCore.mockReset().mockResolvedValue({ ok: true, runId: RUN_ID });
  mocks.revalidatePath.mockReset();
});

describe("手动启动运行", () => {
  it("启动状态待确认时抛出可重试错误，让客户端保留原请求标识", async () => {
    mocks.startRunCore.mockResolvedValueOnce({ ok: false, error: "运行启动状态待确认", retryable: true });

    await expect(startRunAction({ agentId: AGENT_ID, input: {}, requestId: RUN_ID }))
      .rejects.toThrow("运行启动状态待确认");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("运行已启动后缓存刷新失败仍返回运行标识", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.revalidatePath.mockImplementationOnce(() => { throw new Error("缓存暂时不可用"); });

    try {
      await expect(startRunAction({ agentId: AGENT_ID, input: {} })).resolves.toEqual({ ok: true, runId: RUN_ID });
      expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([`/agents/${AGENT_ID}`, "/agents"]);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });

  it("补启已排队运行后缓存刷新失败仍返回启动结果", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.revalidatePath.mockImplementationOnce(() => { throw new Error("缓存暂时不可用"); });

    try {
      await expect(resumeRunStartAction(RUN_ID)).resolves.toEqual({ ok: true, runId: RUN_ID });
      expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([`/runs/${RUN_ID}`, "/runs"]);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });
});
