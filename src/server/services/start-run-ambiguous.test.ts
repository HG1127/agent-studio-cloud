import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { AgentManifest } from "@/contracts/manifest";
import { createRunStartLease } from "@/server/services/run-start-lease";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  completeEvaluationForRun: vi.fn(),
  updateRows: [] as unknown[],
  existingRows: [] as unknown[],
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
    select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.existingRows }) }) }),
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
  mocks.existingRows = [];
  mocks.updateFilters = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("启动响应丢失时的运行状态", () => {
  it("只对尚未开始的 queued 运行落定失败", async () => {
    mocks.updateRows = [{ id: RUN_ID }];

    await expect(launchClaimedRun(args())).resolves.toEqual({ ok: false, error: "运行启动失败，请稍后重试" });
    const query = new PgDialect().sqlToQuery(mocks.updateFilters[0]);
    expect(query.sql).toContain('"runs"."status" =');
    expect(query.params).toContain("queued");
    expect(mocks.completeEvaluationForRun).toHaveBeenCalledOnce();
    expect(vi.mocked(console.error)).toHaveBeenCalledOnce();
  });

  it("运行已越过 queued 时返回已有运行，避免误报后重复发起", async () => {
    mocks.existingRows = [{ id: RUN_ID }];

    await expect(launchClaimedRun(args())).resolves.toEqual({ ok: true, runId: RUN_ID });
    expect(mocks.completeEvaluationForRun).not.toHaveBeenCalled();
  });
});
