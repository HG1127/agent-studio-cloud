import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startMock, cancelMock } = vi.hoisted(() => ({ startMock: vi.fn(), cancelMock: vi.fn() }));
vi.mock("workflow/api", () => ({ start: startMock }));

import { AgentManifest } from "@/contracts/manifest";
import { agents, agentVersions, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { startRunCore } from "@/server/services/start-run-core";

const AGENT_ID = "00000000-0000-4000-8000-0000000007a1";
const VERSION_ID = "00000000-0000-4000-8000-0000000007a2";
const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "7".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "start-recovery",
    startNodeId: "start",
    rootAgent: { id: AGENT_ID, name: "启动恢复测试", role: "测试" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "done" },
      done: { id: "done", title: "结束", type: "end", next: null },
    },
  },
});

async function cleanup() {
  await db.delete(runs).where(eq(runs.agentId, AGENT_ID));
  await db.delete(agentVersions).where(eq(agentVersions.id, VERSION_ID));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
}

beforeEach(async () => {
  await cleanup();
  await db.insert(agents).values({
    id: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    name: "启动恢复测试", intentText: "验证启动句柄保存失败时的状态恢复", status: "published",
  });
  await db.insert(agentVersions).values({
    id: VERSION_ID, agentId: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    version: 1, status: "production", manifest,
  });
  cancelMock.mockReset().mockResolvedValue(undefined);
  startMock.mockReset().mockResolvedValue({ runId: "wrun_test_handle", cancel: cancelMock });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

describe("运行启动句柄恢复", () => {
  it("句柄回写失败时取消失联工作流并把活跃运行置为失败", async () => {
    vi.spyOn(db, "update").mockImplementationOnce(() => { throw new Error("模拟句柄回写失败"); });

    const result = await startRunCore({ agentId: AGENT_ID, input: {} });

    expect(result).toEqual({ ok: false, error: "运行启动失败，请稍后重试" });
    expect(cancelMock).toHaveBeenCalledOnce();
    const [run] = await db.select().from(runs).where(eq(runs.agentId, AGENT_ID));
    expect(run).toMatchObject({ status: "failed", error: "运行启动失败，请稍后重试" });
  });

  it("工作流已先完成时句柄回写失败不会把终态改成失败", async () => {
    const originalUpdate = db.update.bind(db);
    startMock.mockImplementationOnce(async (_workflow, [runId]: [string]) => {
      await originalUpdate(runs)
        .set({ status: "completed", result: { done: true }, finishedAt: new Date() })
        .where(eq(runs.id, runId));
      return { runId: "wrun_test_handle", cancel: cancelMock };
    });
    vi.spyOn(db, "update").mockImplementationOnce(() => { throw new Error("模拟句柄回写失败"); });

    const result = await startRunCore({ agentId: AGENT_ID, input: {} });

    expect(result).toEqual({ ok: false, error: "运行启动失败，请稍后重试" });
    expect(cancelMock).toHaveBeenCalledOnce();
    const [run] = await db.select().from(runs).where(eq(runs.agentId, AGENT_ID));
    expect(run).toMatchObject({ status: "completed", result: { done: true }, error: null });
  });
});
