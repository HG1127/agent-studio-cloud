import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import type { AgentManifest } from "@/contracts/manifest";
import { createRunStartLease } from "@/server/services/run-start-lease";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  completeEvaluationForRun: vi.fn(),
  updateRows: [] as unknown[],
  updateFilters: [] as SQL[],
}));

vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@/server/workflows/agent-run", () => ({ agentRunWorkflow: vi.fn() }));
vi.mock("@/server/services/evaluation-state", () => ({ completeEvaluationForRun: mocks.completeEvaluationForRun }));
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({ set: () => ({ where: (filter: SQL) => {
      mocks.updateFilters.push(filter);
      return { returning: async () => mocks.updateRows };
    } }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  },
}));

import { launchClaimedRun } from "@/server/services/start-run-core";

const RUN_ID = "00000000-0000-4000-8000-0000000000b1";
const args = () => ({
  runId: RUN_ID,
  manifest: {} as AgentManifest,
  input: {},
  lease: createRunStartLease(),
});

beforeEach(() => {
  mocks.start.mockReset().mockRejectedValue(new Error("启动响应丢失"));
  mocks.completeEvaluationForRun.mockReset();
  mocks.updateRows = [];
  mocks.updateFilters = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("启动响应丢失时的运行状态", () => {
  it("无法判定平台是否接收时保留原运行与启动租约", async () => {
    await expect(launchClaimedRun(args())).resolves.toEqual({ ok: true, runId: RUN_ID });
    expect(mocks.updateFilters).toEqual([]);
    expect(vi.mocked(console.error)).toHaveBeenCalledOnce();
    expect(mocks.completeEvaluationForRun).not.toHaveBeenCalled();
  });
});
