import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";

vi.mock("@/server/steps/run-state", () => ({ persistStep: vi.fn() }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: vi.fn() }));

import { agentMemories, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { runMemoryStep } from "@/server/steps/memory-step";

const RUN_ID = "00000000-0000-4000-8000-0000000000e1";
const AGENT_ID = "00000000-0000-4000-8000-0000000000e2";
const VERSION_ID = "00000000-0000-4000-8000-0000000000e3";
const QUERY = "请参考客户续约的历史经验";
const node = WorkflowNode.parse({
  id: "read_memory", title: "读取经验", type: "memory", next: null,
  memory: { mode: "read", query: QUERY, limit: 5 },
});

async function cleanup() {
  await db.delete(agentMemories).where(eq(agentMemories.sourceRunId, RUN_ID));
  await db.delete(runs).where(eq(runs.id, RUN_ID));
}

beforeEach(cleanup);
afterEach(cleanup);

describe("长期经验候选召回", () => {
  it("长中文任务句能召回只包含结尾主题的经验", async () => {
    const query = "请根据客户订单资料和售后服务政策梳理当前审批流程并评估相关人员反馈再确认退款期限";
    await db.insert(runs).values({
      id: RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: AGENT_ID, versionId: VERSION_ID, status: "running", input: {},
    });
    await db.insert(agentMemories).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      sourceRunId: RUN_ID,
      sourceNodeId: "tail-topic",
      content: "退款期限是签收后七天。",
    });
    const queryNode = WorkflowNode.parse({
      id: "read_memory", title: "读取经验", type: "memory", next: null,
      memory: { mode: "read", query, limit: 5 },
    });

    const result = await runMemoryStep({ runId: RUN_ID, node: queryNode, input: {}, outputs: {} });

    expect(result.output).toMatchObject({ mode: "read", foundCount: 1 });
    expect(result.output.memories).toEqual([expect.objectContaining({ content: "退款期限是签收后七天。" })]);
  });

  it("第 101 条完整命中优先于最近 100 条片段命中", async () => {
    await db.insert(runs).values({
      id: RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: AGENT_ID, versionId: VERSION_ID, status: "running", input: {},
    });
    const recent = new Date("2026-09-27T00:00:00.000Z");
    const old = new Date("2026-09-01T00:00:00.000Z");
    await db.insert(agentMemories).values([
      ...Array.from({ length: 100 }, (_, index) => ({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        agentId: AGENT_ID,
        sourceRunId: RUN_ID,
        sourceNodeId: `recent-${index}`,
        content: "客户续约背景信息。",
        createdAt: recent,
      })),
      {
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        agentId: AGENT_ID,
        sourceRunId: RUN_ID,
        sourceNodeId: "old-exact",
        content: `${QUERY}：提前三十天联系负责人。`,
        createdAt: old,
      },
    ]);

    const result = await runMemoryStep({ runId: RUN_ID, node, input: {}, outputs: {} });

    expect(result.output).toMatchObject({ mode: "read", foundCount: 5 });
    const memories = result.output.memories as Array<{ content: string }>;
    expect(memories[0].content).toContain("提前三十天");
  });
});
