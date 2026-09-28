import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));
vi.mock("@/server/services/start-run-core", () => ({ resumeQueuedRunStartCore: vi.fn() }));

import { recoverStaleQueuedRuns } from "@/server/services/recover-stale-runs";

beforeEach(() => mocks.select.mockReset());

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
});
