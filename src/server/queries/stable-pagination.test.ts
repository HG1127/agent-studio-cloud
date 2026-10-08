import { desc } from "drizzle-orm";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ orderBy: vi.fn() }));

vi.mock("@/lib/db", () => {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: (...columns: unknown[]) => { mocks.orderBy(...columns); return chain; },
    limit: () => chain,
    offset: async () => [],
  };
  return { db: { select: () => chain } };
});

import { agentMemories, agents, evaluationCases, evaluationRuns, knowledgeSources, runFeedback, runs } from "@/db/schema";
import { listAgents } from "@/server/queries/agents";
import { listEvaluationCases, listEvaluationRuns } from "@/server/queries/evaluations";
import { listKnowledgeSources } from "@/server/queries/knowledge";
import { listMemories } from "@/server/queries/memory";
import { listImprovementFeedback } from "@/server/queries/run-feedback";
import { listRuns } from "@/server/queries/runs";

const WORKSPACE_ID = "00000000-0000-4000-8000-00000000fa00";
const AGENT_ID = "00000000-0000-4000-8000-00000000fa01";

it("用户列表在时间相同时都以唯一标识稳定排序", async () => {
  await Promise.all([
    listAgents(WORKSPACE_ID),
    listRuns(WORKSPACE_ID),
    listKnowledgeSources(),
    listEvaluationCases(AGENT_ID, WORKSPACE_ID),
    listEvaluationRuns(AGENT_ID, WORKSPACE_ID),
    listMemories(),
    listImprovementFeedback(),
  ]);

  expect(mocks.orderBy).toHaveBeenCalledWith(desc(agents.updatedAt), desc(agents.id));
  expect(mocks.orderBy).toHaveBeenCalledWith(desc(runs.createdAt), desc(runs.id));
  expect(mocks.orderBy).toHaveBeenCalledWith(desc(knowledgeSources.createdAt), desc(knowledgeSources.id));
  expect(mocks.orderBy).toHaveBeenCalledWith(desc(evaluationCases.createdAt), desc(evaluationCases.id));
  expect(mocks.orderBy).toHaveBeenCalledWith(desc(evaluationRuns.createdAt), desc(evaluationRuns.id));
  expect(mocks.orderBy).toHaveBeenCalledWith(desc(agentMemories.createdAt), desc(agentMemories.id));
  expect(mocks.orderBy).toHaveBeenCalledWith(desc(runFeedback.updatedAt), desc(runFeedback.id));
});
