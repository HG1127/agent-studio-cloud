import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { agents, agentVersions, auditEvents, evaluationCases, runFeedback, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { createRegressionCaseFromRunFeedbackAction, saveRunFeedbackAction } from "@/server/actions/run-feedback";
import { getRunFeedback, listImprovementFeedback } from "@/server/queries/run-feedback";
import { listMemoryAgentOptions } from "@/server/queries/memory";

const AGENT_ID = "00000000-0000-4000-8000-0000000000f1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000f2";
const RUN_ID = "00000000-0000-4000-8000-0000000000f3";

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "run-feedback",
  workflowSnapshot: {
    id: "workflow", versionId: null, startNodeId: "start",
    rootAgent: { id: AGENT_ID, name: "反馈助手", role: "业务助手" },
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
  await db.delete(auditEvents).where(eq(auditEvents.targetId, RUN_ID));
  await db.delete(runFeedback).where(eq(runFeedback.runId, RUN_ID));
  await db.delete(evaluationCases).where(eq(evaluationCases.agentId, AGENT_ID));
  await db.delete(runs).where(eq(runs.id, RUN_ID));
  await db.delete(agentVersions).where(eq(agentVersions.id, VERSION_ID));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
});

async function insertFixture(status = "completed") {
  await db.insert(agents).values({
    id: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    name: "反馈助手", intentText: "收集运行反馈并形成可重复执行的改进验收样例",
  });
  await db.insert(agentVersions).values({
    id: VERSION_ID, agentId: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    version: 1, status: "production", manifest,
  });
  await db.insert(runs).values({
    id: RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    agentId: AGENT_ID, versionId: VERSION_ID, status, input: { request: "检查合同" }, result: { answer: "完成" },
  });
}

describe("运行反馈闭环", () => {
  it("同一次运行更新反馈时只保留一条记录", async () => {
    await insertFixture();
    expect((await saveRunFeedbackAction({ runId: RUN_ID, rating: "useful" })).ok).toBe(true);
    expect((await saveRunFeedbackAction({ runId: RUN_ID, rating: "needs_improvement", note: "缺少条款依据" })).ok).toBe(true);

    const rows = await db.select().from(runFeedback).where(eq(runFeedback.runId, RUN_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: "needs_improvement", note: "缺少条款依据" });
    expect(await listImprovementFeedback({ agentId: AGENT_ID, query: "条款" })).toEqual([
      expect.objectContaining({ runId: RUN_ID, agentName: "反馈助手", agentArchived: false, note: "缺少条款依据" }),
    ]);
    expect(await listMemoryAgentOptions()).toContainEqual({ id: AGENT_ID, name: "反馈助手" });
  });

  it("差评只创建一个可编辑回归样例并复制真实输入", async () => {
    await insertFixture();
    await db.update(runs).set({ input: { request: "检查合同", apiKey: "sk-feedback-secret-value" } }).where(eq(runs.id, RUN_ID));
    await saveRunFeedbackAction({ runId: RUN_ID, rating: "needs_improvement", note: "缺少条款依据" });

    const first = await createRegressionCaseFromRunFeedbackAction(RUN_ID);
    const second = await createRegressionCaseFromRunFeedbackAction(RUN_ID);

    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    const cases = await db.select().from(evaluationCases).where(eq(evaluationCases.agentId, AGENT_ID));
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      input: { request: "检查合同", apiKey: "[已隐藏敏感信息]" },
      expectations: [],
    });
  });

  it("写入和读取反馈时隐藏误贴的服务凭据", async () => {
    await insertFixture();
    const result = await saveRunFeedbackAction({
      runId: RUN_ID,
      rating: "needs_improvement",
      note: "缺少依据，authorization: Bearer private-feedback-token",
    });

    expect(result).toMatchObject({
      ok: true,
      feedback: { note: "缺少依据，[已隐藏敏感信息]" },
    });
    const [stored] = await db.select({ note: runFeedback.note }).from(runFeedback).where(eq(runFeedback.runId, RUN_ID));
    expect(stored?.note).toBe("缺少依据，[已隐藏敏感信息]");

    await db.update(runFeedback)
      .set({ note: "历史反馈 secret=legacy-private-value" })
      .where(eq(runFeedback.runId, RUN_ID));
    expect(await listImprovementFeedback({ agentId: AGENT_ID })).toEqual([
      expect.objectContaining({ note: "历史反馈 [已隐藏敏感信息]" }),
    ]);
    expect(await getRunFeedback(RUN_ID, DEMO_WORKSPACE_ID)).toEqual(
      expect.objectContaining({ note: "历史反馈 [已隐藏敏感信息]" }),
    );
  });

  it("运行未完成时拒绝提交结果反馈", async () => {
    await insertFixture("running");
    expect(await saveRunFeedbackAction({ runId: RUN_ID, rating: "useful" })).toEqual({
      ok: false, error: "运行完成后才能评价结果",
    });
  });
});
