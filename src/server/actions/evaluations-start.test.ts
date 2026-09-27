import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  startRun: vi.fn(),
  markFailure: vi.fn(),
  reconcile: vi.fn(),
  reconcileSummary: vi.fn(),
  revalidatePath: vi.fn(),
  updates: 0,
  updateError: false,
  existingRun: null as { id: string; status: string } | null,
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
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.existingRun ? [mocks.existingRun] : [] }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          mocks.updates += 1;
          if (mocks.updateError) throw new Error("关联运行号暂时失败");
          return [];
        },
      }),
    }),
  },
}));

import { startEvaluationAction } from "@/server/actions/evaluations";

const AGENT_ID = "00000000-0000-4000-8000-0000000000a1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000a2";
const EVALUATION_ID = "00000000-0000-4000-8000-0000000000a3";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000a4";

beforeEach(() => {
  mocks.prepare.mockReset();
  mocks.startRun.mockReset();
  mocks.markFailure.mockReset().mockResolvedValue(undefined);
  mocks.reconcile.mockReset().mockResolvedValue(undefined);
  mocks.reconcileSummary.mockReset().mockResolvedValue(undefined);
  mocks.revalidatePath.mockReset();
  mocks.updates = 0;
  mocks.updateError = false;
  mocks.existingRun = null;
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

    await expect(startEvaluationAction(AGENT_ID, REQUEST_ID)).resolves.toEqual({
      ok: false, error: "部分验收结果尚未对账，请点击“检查并继续”重试",
    });

    expect(mocks.prepare).toHaveBeenCalledWith(AGENT_ID, REQUEST_ID);
    expect(peak).toBe(5);
    expect(mocks.startRun).toHaveBeenCalledTimes(8);
    expect(mocks.markFailure).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).toHaveBeenCalledTimes(6);
    expect(mocks.reconcileSummary).toHaveBeenCalledWith(EVALUATION_ID);
    expect(mocks.updates).toBe(6);
  });

  it("运行已启动但关联运行号失败时不误记样例失败", async () => {
    const testCase = { id: "00000000-0000-4000-8000-0000000000b1", input: {} };
    mocks.prepare.mockResolvedValue({
      ok: true, evaluationId: EVALUATION_ID, versionId: VERSION_ID, cases: [testCase], resumed: false,
    });
    mocks.startRun.mockResolvedValue({ ok: true, runId: "00000000-0000-4000-8000-0000000000b2" });
    mocks.updateError = true;

    await expect(startEvaluationAction(AGENT_ID)).resolves.toEqual({
      ok: false, error: "部分验收结果尚未对账，请点击“检查并继续”重试",
    });

    expect(mocks.markFailure).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.reconcileSummary).toHaveBeenCalledWith(EVALUATION_ID);
  });

  it("运行已启动但终态对账失败时保留待处理样例供幂等重试", async () => {
    const testCase = { id: "00000000-0000-4000-8000-0000000000b3", input: {} };
    mocks.prepare.mockResolvedValue({
      ok: true, evaluationId: EVALUATION_ID, versionId: VERSION_ID, cases: [testCase], resumed: false,
    });
    mocks.startRun.mockResolvedValue({ ok: true, runId: "00000000-0000-4000-8000-0000000000b4" });
    mocks.reconcile.mockRejectedValueOnce(new Error("终态查询暂时失败"));

    await expect(startEvaluationAction(AGENT_ID)).resolves.toEqual({
      ok: false, error: "部分验收结果尚未对账，请点击“检查并继续”重试",
    });

    expect(mocks.markFailure).not.toHaveBeenCalled();
    expect(mocks.updates).toBe(1);
    expect(mocks.reconcileSummary).toHaveBeenCalledWith(EVALUATION_ID);
  });

  it("启动返回失败但运行已经存在时按真实运行对账", async () => {
    const testCase = { id: "00000000-0000-4000-8000-0000000000b5", input: {} };
    const runId = "00000000-0000-4000-8000-0000000000b6";
    mocks.prepare.mockResolvedValue({
      ok: true, evaluationId: EVALUATION_ID, versionId: VERSION_ID, cases: [testCase], resumed: true,
    });
    mocks.startRun.mockResolvedValue({ ok: false, error: "运行启动已由新的请求接管" });
    mocks.existingRun = { id: runId, status: "completed" };

    await expect(startEvaluationAction(AGENT_ID)).resolves.toEqual({ ok: true });

    expect(mocks.markFailure).not.toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledWith(runId);
    expect(mocks.updates).toBe(1);
  });

  it("已有排队运行未启动时保留样例，提示继续检查", async () => {
    const testCase = { id: "00000000-0000-4000-8000-0000000000b7", input: {} };
    mocks.prepare.mockResolvedValue({
      ok: true, evaluationId: EVALUATION_ID, versionId: VERSION_ID, cases: [testCase], resumed: true,
    });
    mocks.startRun.mockRejectedValue(new Error("启动状态暂时未知"));
    mocks.existingRun = { id: "00000000-0000-4000-8000-0000000000b8", status: "queued" };

    await expect(startEvaluationAction(AGENT_ID)).resolves.toEqual({
      ok: false, error: "部分验收结果尚未对账，请点击“检查并继续”重试",
    });

    expect(mocks.markFailure).not.toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledWith(mocks.existingRun.id);
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

  it("验收已完成对账后缓存刷新失败不误报启动失败", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.prepare.mockResolvedValue({
      ok: true, evaluationId: EVALUATION_ID, versionId: VERSION_ID, cases: [], resumed: true,
    });
    mocks.revalidatePath.mockImplementationOnce(() => { throw new Error("缓存暂时不可用"); });

    await expect(startEvaluationAction(AGENT_ID)).resolves.toEqual({ ok: true });

    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([`/agents/${AGENT_ID}`, "/runs"]);
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("拒绝无效请求标识且不创建验收批次", async () => {
    await expect(startEvaluationAction(AGENT_ID, "bad")).resolves.toEqual({
      ok: false,
      error: "助手或验收请求信息不正确",
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
