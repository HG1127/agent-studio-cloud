import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { agentVersions, agents, evaluationCaseResults, evaluationCases, evaluationRuns, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { createEvaluationCaseAction, setEvaluationCaseArchivedAction, updateEvaluationCaseAction } from "@/server/actions/evaluations";
import { completeEvaluationForRun } from "@/server/services/evaluation-state";
import { prepareEvaluationRun } from "@/server/services/evaluation-start";

const AGENT_ID = "00000000-0000-4000-8000-0000000000a1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000a2";
const CASE_ID = "00000000-0000-4000-8000-0000000000a3";
const RUN_ID = "00000000-0000-4000-8000-0000000000a4";
const CASE_ID_2 = "00000000-0000-4000-8000-0000000000a5";
const RUN_ID_2 = "00000000-0000-4000-8000-0000000000a6";

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "evaluation-concurrency",
  workflowSnapshot: {
    id: "workflow", versionId: null, startNodeId: "start",
    rootAgent: { id: "agent", name: "并发验收助手", role: "owner" },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "end", requirementIds: [], businessSpec: null },
      end: { id: "end", title: "结束", type: "end", next: null, requirementIds: [], businessSpec: null },
    },
    variables: [], memoryPolicy: { taskContext: true, longTerm: false }, outputContract: { fields: [] }, ui: { positions: {} },
  },
  inputContract: { fields: [] }, outputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, knowledgeSnapshot: [],
});

afterEach(async () => {
  await db.delete(runs).where(eq(runs.id, RUN_ID));
  await db.delete(runs).where(eq(runs.id, RUN_ID_2));
  const evaluations = await db.select({ id: evaluationRuns.id }).from(evaluationRuns).where(eq(evaluationRuns.agentId, AGENT_ID));
  for (const evaluation of evaluations) {
    await db.delete(evaluationCaseResults).where(eq(evaluationCaseResults.evaluationRunId, evaluation.id));
  }
  await db.delete(evaluationRuns).where(eq(evaluationRuns.agentId, AGENT_ID));
  await db.delete(evaluationCases).where(eq(evaluationCases.agentId, AGENT_ID));
  await db.delete(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
});

async function insertFixture() {
  await db.insert(agents).values({
    id: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    name: "并发验收助手", intentText: "验证自动验收只会启动一次",
  });
  await db.insert(agentVersions).values({
    id: VERSION_ID, agentId: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    version: 1, status: "candidate", manifest,
  });
  await db.insert(evaluationCases).values({
    id: CASE_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: AGENT_ID,
    name: "基础样例", input: {}, expectations: [],
  });
}

describe("自动验收并发启动", () => {
  it("同一助手同时发起两次时复用同一轮验收", async () => {
    await insertFixture();
    const results = await Promise.all([prepareEvaluationRun(AGENT_ID), prepareEvaluationRun(AGENT_ID)]);

    expect(results.every((result) => result.ok)).toBe(true);
    const successful = results.filter((result) => result.ok);
    expect(new Set(successful.map((result) => result.evaluationId)).size).toBe(1);
    expect(successful.some((result) => result.resumed)).toBe(true);
    const active = await db.select().from(evaluationRuns).where(eq(evaluationRuns.agentId, AGENT_ID));
    expect(active).toHaveLength(1);
  });

  it("验收运行期间拒绝新增编辑和停用样例", async () => {
    await insertFixture();
    expect((await prepareEvaluationRun(AGENT_ID)).ok).toBe(true);

    const [created, updated, archived] = await Promise.all([
      createEvaluationCaseAction({ agentId: AGENT_ID, name: "新增样例", input: {}, expectations: [] }),
      updateEvaluationCaseAction({ caseId: CASE_ID, agentId: AGENT_ID, name: "被修改", input: {}, expectations: [] }),
      setEvaluationCaseArchivedAction({ caseId: CASE_ID, agentId: AGENT_ID, archived: true }),
    ]);

    expect(created).toEqual({ ok: false, error: "自动验收运行期间不能修改验收样例" });
    expect(updated).toEqual({ ok: false, error: "自动验收运行期间不能修改验收样例" });
    expect(archived).toEqual({ ok: false, error: "自动验收运行期间不能修改验收样例" });
    const cases = await db.select().from(evaluationCases).where(eq(evaluationCases.agentId, AGENT_ID));
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ name: "基础样例", archivedAt: null });
  });

  it("重复完成回调不会覆盖已经落定的验收结果", async () => {
    await insertFixture();
    await db.update(evaluationCases).set({ expectations: [{ path: "answer", operator: "equals", value: "通过" }] }).where(eq(evaluationCases.id, CASE_ID));
    const prepared = await prepareEvaluationRun(AGENT_ID);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    await db.insert(runs).values({
      id: RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: AGENT_ID, versionId: VERSION_ID, status: "completed", input: {}, result: { answer: "通过" },
      sourceType: "evaluation", sourceKey: `evaluation:${prepared.evaluationId}:${CASE_ID}`,
    });

    await completeEvaluationForRun(RUN_ID, { answer: "通过" });
    await db.update(evaluationCases).set({ expectations: [{ path: "answer", operator: "equals", value: "已修改" }] }).where(eq(evaluationCases.id, CASE_ID));
    await completeEvaluationForRun(RUN_ID, null, "迟到的重复失败回调");

    const [result] = await db.select().from(evaluationCaseResults).where(eq(evaluationCaseResults.evaluationRunId, prepared.evaluationId));
    expect(result).toMatchObject({ status: "passed", error: null, runId: RUN_ID });
  });

  it("多个样例同时完成时汇总不会被较早的部分结果覆盖", async () => {
    await insertFixture();
    await db.update(evaluationCases)
      .set({ expectations: [{ path: "answer", operator: "equals", value: "通过" }] })
      .where(eq(evaluationCases.id, CASE_ID));
    await db.insert(evaluationCases).values({
      id: CASE_ID_2,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      name: "并发样例",
      input: {},
      expectations: [{ path: "answer", operator: "equals", value: "通过" }],
    });
    const prepared = await prepareEvaluationRun(AGENT_ID);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    await db.insert(runs).values([
      {
        id: RUN_ID,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        agentId: AGENT_ID,
        versionId: VERSION_ID,
        status: "completed",
        input: {},
        result: { answer: "通过" },
        sourceType: "evaluation",
        sourceKey: `evaluation:${prepared.evaluationId}:${CASE_ID}`,
      },
      {
        id: RUN_ID_2,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        agentId: AGENT_ID,
        versionId: VERSION_ID,
        status: "completed",
        input: {},
        result: { answer: "通过" },
        sourceType: "evaluation",
        sourceKey: `evaluation:${prepared.evaluationId}:${CASE_ID_2}`,
      },
    ]);

    await Promise.all([
      completeEvaluationForRun(RUN_ID, { answer: "通过" }),
      completeEvaluationForRun(RUN_ID_2, { answer: "通过" }),
    ]);

    const [evaluation] = await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, prepared.evaluationId));
    const [version] = await db.select().from(agentVersions).where(eq(agentVersions.id, VERSION_ID));
    expect(evaluation).toMatchObject({ status: "completed", passedCount: 2, failedCount: 0, totalCount: 2 });
    expect(evaluation.finishedAt).not.toBeNull();
    expect(version.status).toBe("production");
  });
});
