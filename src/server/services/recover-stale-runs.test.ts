import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), resume: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));
vi.mock("@/server/services/start-run-core", () => ({ resumeQueuedRunStartCore: mocks.resume }));

import { recoverStaleQueuedRuns } from "@/server/services/recover-stale-runs";

beforeEach(() => {
  mocks.select.mockReset();
  mocks.resume.mockReset();
});

const staleRows = (ids: string[]) => ({
  from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => ids.map((id) => ({ id })) }) }) }),
});

describe("过期排队运行接管", () => {
  it("数据库不可用时向调用方抛错，日志只保留脱敏信息", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("authorization: Bearer private-recovery-token");
    mocks.select.mockImplementationOnce(() => { throw error; });

    try {
      await expect(recoverStaleQueuedRuns()).rejects.toBe(error);
      expect(JSON.stringify(log.mock.calls)).toContain("接管过期排队运行失败");
      expect(JSON.stringify(log.mock.calls)).not.toContain("private-recovery-token");
    } finally {
      log.mockRestore();
    }
  });

  it("单条接管暂时失败时继续处理其他运行并向调用方抛错", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ids = ["00000000-0000-4000-8000-0000000000b1", "00000000-0000-4000-8000-0000000000b2"];
    mocks.select.mockReturnValueOnce(staleRows(ids));
    mocks.resume
      .mockResolvedValueOnce({ ok: false, error: "继续启动失败，请稍后重试", retryable: true })
      .mockResolvedValueOnce({ ok: true, runId: ids[1] });

    try {
      await expect(recoverStaleQueuedRuns()).rejects.toThrow("部分过期运行接管暂时失败");
      expect(mocks.resume.mock.calls.map(([id]) => id)).toEqual(ids);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });

  it("永久业务失败不把定时任务标记为暂时故障", async () => {
    const id = "00000000-0000-4000-8000-0000000000b1";
    mocks.select.mockReturnValueOnce(staleRows([id]));
    mocks.resume.mockResolvedValueOnce({ ok: false, error: "运行信息不完整，无法继续启动" });

    await expect(recoverStaleQueuedRuns()).resolves.toBeUndefined();
    expect(mocks.resume).toHaveBeenCalledWith(id);
  });
});
