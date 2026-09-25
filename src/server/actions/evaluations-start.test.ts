import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  startRun: vi.fn(),
  markFailure: vi.fn(),
  reconcile: vi.fn(),
  reconcileSummary: vi.fn(),
  revalidatePath: vi.fn(),
  updates: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/services/evaluation-start", () => ({ prepareEvaluationRun: mocks.prepare }));
vi.mock("@/server/services/start-run-core", () => ({ startRunCore: mocks.startRun }));
vi.mock("@/server/services/evaluation-state", () => ({
  markEvaluationStartFailure: mocks.markFailure,
  reconcileTerminalEvaluationRun: mocks.reconcile,
  reconcileEvaluationSummary: mocks.reconcileSummary,
}));
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: async () => { mocks.updates += 1; return []; },
      }),
    }),
  },
}));

import { startEvaluationAction } from "@/server/actions/evaluations";

const AGENT_ID = "00000000-0000-4000-8000-0000000000a1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000a2";
const EVALUATION_ID = "00000000-0000-4000-8000-0000000000a3";

beforeEach(() => {
  mocks.prepare.mockReset();
  mocks.startRun.mockReset();
  mocks.markFailure.mockReset().mockResolvedValue(undefined);
  mocks.reconcile.mockReset().mockResolvedValue(undefined);
  mocks.reconcileSummary.mockReset().mockResolvedValue(undefined);
  mocks.revalidatePath.mockReset();
  mocks.updates = 0;
});

describe("批量启动自动验收", () => {
  it("最多并发启动五条，单条异常不阻断其余样例", async () => {
    const cases = Array.from({ length: 8 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      input: { index },
    }));
    mocks.prepare.mockResolvedValue({
      ok: true,
      evaluationId: EVALUATION_ID,
      versionId: VERSION_ID,
      cases,
      resumed: false,
    });
    let active = 0;
    let peak = 0;
    mocks.startRun.mockImplementation(async ({ sourceKey }: { sourceKey: string }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (sourceKey.endsWith(cases[2].id)) throw new Error("模拟异常");
      if (sourceKey.endsWith(cases[3].id)) return { ok: false, error: "模拟启动失败" };
      return { ok: true, runId: sourceKey.slice(-36) };
    });

    await expect(startEvaluationAction(AGENT_ID)).resolves.toEqual({ ok: true });

    expect(peak).toBe(5);
    expect(mocks.startRun).toHaveBeenCalledTimes(8);
    expect(mocks.markFailure).toHaveBeenCalledTimes(2);
    expect(mocks.reconcile).toHaveBeenCalledTimes(6);
    expect(mocks.reconcileSummary).toHaveBeenCalledWith(EVALUATION_ID);
    expect(mocks.updates).toBe(6);
  });

  it("没有待补启样例时仍重新汇总已落定结果", async () => {
    mocks.prepare.mockResolvedValue({
      ok: true,
      evaluationId: EVALUATION_ID,
      versionId: VERSION_ID,
      cases: [],
      resumed: true,
    });

    await expect(startEvaluationAction(AGENT_ID)).resolves.toEqual({ ok: true });

    expect(mocks.startRun).not.toHaveBeenCalled();
    expect(mocks.reconcileSummary).toHaveBeenCalledOnce();
    expect(mocks.reconcileSummary).toHaveBeenCalledWith(EVALUATION_ID);
  });
});
