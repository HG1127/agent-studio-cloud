import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { agents, auditEvents, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { importAgentAction } from "@/server/actions/import-agent";

const AGENT_ID = "00000000-0000-4000-8000-0000000000d1";
const workflow = WorkflowDraft.parse({
  id: "workflow-import-retry",
  rootAgent: { id: AGENT_ID, name: "导入助手", role: "业务助手" },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "done" },
    done: { id: "done", title: "结束", type: "end", next: null },
  },
  memoryPolicy: { taskContext: true, longTerm: false },
});
const payload = {
  format: "agent-studio-cloud",
  formatVersion: 1,
  exportedAt: "2026-09-26T00:00:00.000Z",
  agent: {
    name: "导入助手",
    description: "验证导入响应丢失后的安全重试",
    intentText: "验证导入响应丢失以后不会重复创建助手副本",
  },
  workflow,
};

afterEach(async () => {
  await db.delete(auditEvents).where(eq(auditEvents.targetId, AGENT_ID));
  await db.delete(workflowDefinitions).where(eq(workflowDefinitions.agentId, AGENT_ID));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
});

describe("助手导入安全重试", () => {
  it("响应丢失后使用同一请求标识时复用已导入助手", async () => {
    await db.insert(agents).values({
      id: AGENT_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      name: payload.agent.name,
      description: payload.agent.description,
      intentText: payload.agent.intentText,
    });
    await db.insert(workflowDefinitions).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      draft: workflow,
    });

    expect(await importAgentAction(payload, AGENT_ID)).toEqual({ ok: true, agentId: AGENT_ID });
    expect(await db.select().from(agents).where(eq(agents.id, AGENT_ID))).toHaveLength(1);
  });

  it("同一请求标识不能被同名但不同流程的文件复用", async () => {
    expect(await importAgentAction(payload, AGENT_ID)).toEqual({ ok: true, agentId: AGENT_ID });
    const changed = {
      ...payload,
      workflow: WorkflowDraft.parse({ ...workflow, memoryPolicy: { taskContext: true, longTerm: true } }),
    };
    expect(await importAgentAction(changed, AGENT_ID)).toEqual({
      ok: false,
      error: "导入请求信息已经失效，请重新选择文件",
    });
  });
});
