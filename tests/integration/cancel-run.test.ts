import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { appendTraceMock, cancelMock, getRunMock, revalidatePathMock } = vi.hoisted(() => ({
  appendTraceMock: vi.fn(),
  cancelMock: vi.fn(),
  getRunMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));
vi.mock("workflow/api", () => ({ getRun: getRunMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: appendTraceMock }));

import { approvals, runSteps, runs } from "@/db/schema";
import { WorkflowDraft } from "@/contracts/workflow";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { cancelRunAction } from "@/server/actions/cancel-run";
import { recordDecision } from "@/server/steps/approval-step";
import { failRun, finalizeRun, initializeRun, persistStep } from "@/server/steps/run-state";

const RUN_ID = "00000000-0000-4000-8000-0000000000c1";
const CHILD_RUN_ID = "00000000-0000-4000-8000-0000000000c4";
const GRANDCHILD_RUN_ID = "00000000-0000-4000-8000-0000000000c5";
const draft = WorkflowDraft.parse({
  id: "initialization-guard", versionId: null, startNodeId: "start",
  rootAgent: { id: "agent", name: "状态机测试", role: "owner" },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: null },
    confirm: {
      id: "confirm", title: "负责人确认", type: "human", next: null,
      approval: { role: "负责人", reason: "确认是否继续" },
    },
  },
  variables: [], memoryPolicy: { taskContext: true, longTerm: false }, ui: { positions: {} },
});

async function cleanup() {
  await db.delete(approvals).where(inArray(approvals.runId, [RUN_ID, CHILD_RUN_ID, GRANDCHILD_RUN_ID]));
  await db.delete(runSteps).where(inArray(runSteps.runId, [RUN_ID, CHILD_RUN_ID, GRANDCHILD_RUN_ID]));
  await db.delete(runs).where(inArray(runs.id, [CHILD_RUN_ID, GRANDCHILD_RUN_ID, RUN_ID]));
}

beforeAll(cleanup, 60_000);

afterEach(async () => {
  cancelMock.mockReset();
  appendTraceMock.mockReset();
  getRunMock.mockReset();
  revalidatePathMock.mockReset();
  await cleanup();
}, 60_000);

async function insertWaitingRun() {
  await db.insert(runs).values({
    id: RUN_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    agentId: "00000000-0000-4000-8000-0000000000c2",
    versionId: "00000000-0000-4000-8000-0000000000c3",
    workflowRunId: "workflow-cancel-test",
    status: "waiting_approval",
    input: {},
  });
  await db.insert(approvals).values([
    {
      runId: RUN_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      nodeId: "approval_pending",
      nodeTitle: "等待确认",
      status: "pending",
      role: "负责人",
      reason: "请确认是否继续",
    },
    {
      runId: RUN_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      nodeId: "approval_completed",
      nodeTitle: "已完成确认",
      status: "approved",
      role: "负责人",
      reason: "历史确认",
      note: "已同意",
      decidedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ]);
}

describe("取消运行", () => {
  it("取消等待确认的运行时同步关闭尚未处理的确认", async () => {
    await insertWaitingRun();
    cancelMock.mockResolvedValue(undefined);
    getRunMock.mockReturnValue({ cancel: cancelMock });

    await expect(cancelRunAction(RUN_ID)).resolves.toEqual({ ok: true });

    expect(getRunMock).toHaveBeenCalledWith("workflow-cancel-test");
    expect(cancelMock).toHaveBeenCalledOnce();
    const [run] = await db.select().from(runs).where(eq(runs.id, RUN_ID));
    expect(run.status).toBe("cancelled");
    const approvalRows = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, RUN_ID), eq(approvals.workspaceId, DEMO_WORKSPACE_ID)));
    expect(approvalRows.find((row) => row.nodeId === "approval_pending")).toMatchObject({
      status: "rejected",
      note: "运行已取消，确认未继续",
      decidedAt: expect.any(Date),
    });
    expect(approvalRows.find((row) => row.nodeId === "approval_completed")).toMatchObject({
      status: "approved",
      note: "已同意",
    });
  });

  it("取消父运行时同步取消仍在执行的协作与交接后代", async () => {
    await insertWaitingRun();
    await db.insert(runs).values([
      {
        id: CHILD_RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
        agentId: "00000000-0000-4000-8000-0000000000c6", versionId: "00000000-0000-4000-8000-0000000000c7",
        status: "running", input: {}, sourceType: "agent_call", sourceKey: `agent-call:${RUN_ID}:research`,
      },
      {
        id: GRANDCHILD_RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
        agentId: "00000000-0000-4000-8000-0000000000c8", versionId: "00000000-0000-4000-8000-0000000000c9",
        status: "waiting_approval", input: {}, sourceType: "handoff", sourceKey: `handoff:${CHILD_RUN_ID}:delivery`,
      },
    ]);
    await db.insert(approvals).values({
      runId: GRANDCHILD_RUN_ID, workspaceId: DEMO_WORKSPACE_ID, nodeId: "confirm_delivery",
      nodeTitle: "确认交付", status: "pending", role: "负责人", reason: "确认交付内容",
    });
    cancelMock.mockResolvedValue(undefined);
    getRunMock.mockReturnValue({ cancel: cancelMock });

    expect(await cancelRunAction(CHILD_RUN_ID)).toEqual({ ok: true });
    expect(getRunMock).toHaveBeenCalledWith("workflow-cancel-test");

    const children = await db.select().from(runs).where(inArray(runs.id, [CHILD_RUN_ID, GRANDCHILD_RUN_ID]));
    expect(children).toHaveLength(2);
    expect(children.every((child) => child.status === "cancelled" && child.error === "上级运行已取消")).toBe(true);
    const [approval] = await db.select().from(approvals).where(eq(approvals.runId, GRANDCHILD_RUN_ID));
    expect(approval).toMatchObject({ status: "rejected", note: "运行已取消，确认未继续" });
  });

  it("等待确认的运行失败时同步关闭尚未处理的确认", async () => {
    await insertWaitingRun();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await failRun(RUN_ID, "执行引擎异常");

    errorSpy.mockRestore();
    const [run] = await db.select().from(runs).where(eq(runs.id, RUN_ID));
    expect(run).toMatchObject({ status: "failed", error: "执行引擎异常" });
    const approvalRows = await db.select().from(approvals).where(eq(approvals.runId, RUN_ID));
    expect(approvalRows.find((row) => row.nodeId === "approval_pending")).toMatchObject({
      status: "rejected",
      note: "运行失败，确认未继续",
      decidedAt: expect.any(Date),
    });
    expect(approvalRows.find((row) => row.nodeId === "approval_completed")?.status).toBe("approved");
  });

  it("初始化步骤不能把已经失败的运行重新变成运行中", async () => {
    await insertWaitingRun();
    await db.update(runs).set({ status: "failed", error: "启动句柄回写失败" }).where(eq(runs.id, RUN_ID));

    await expect(initializeRun(RUN_ID, draft)).rejects.toThrow("运行已经结束，不能重新启动");

    const [run] = await db.select().from(runs).where(eq(runs.id, RUN_ID));
    expect(run).toMatchObject({ status: "failed", error: "启动句柄回写失败" });
    expect(appendTraceMock).not.toHaveBeenCalled();
  });

  it("迟到的完成回调不能把已取消运行改成已完成", async () => {
    await insertWaitingRun();
    await db.update(runs).set({
      status: "cancelled",
      error: "已由员工取消",
      context: { outputs: { retained: "取消前内容" } },
    }).where(eq(runs.id, RUN_ID));

    await finalizeRun(RUN_ID, { answer: "迟到结果" });

    const [run] = await db.select().from(runs).where(eq(runs.id, RUN_ID));
    expect(run).toMatchObject({
      status: "cancelled",
      result: null,
      context: { outputs: { retained: "取消前内容" } },
      error: "已由员工取消",
    });
    expect(appendTraceMock).not.toHaveBeenCalled();
  });

  it("运行取消后忽略迟到的步骤结果和轨迹", async () => {
    await insertWaitingRun();
    await db.update(runs).set({ status: "cancelled", error: "已由员工取消" }).where(eq(runs.id, RUN_ID));

    await expect(persistStep({
      runId: RUN_ID, nodeId: "late_step", nodeTitle: "迟到步骤", nodeType: "ai",
      status: "succeeded", output: { answer: "迟到结果" },
    })).rejects.toThrow("运行已经结束，忽略迟到的步骤结果");

    expect(await db.select().from(runSteps).where(eq(runSteps.runId, RUN_ID))).toHaveLength(0);
    expect(appendTraceMock).not.toHaveBeenCalled();
  });

  it("运行取消后迟到的确认结果不能覆盖已关闭状态", async () => {
    await insertWaitingRun();
    const [approval] = await db.select().from(approvals).where(and(
      eq(approvals.runId, RUN_ID), eq(approvals.nodeId, "approval_pending"),
    ));
    await db.update(runs).set({ status: "cancelled", error: "已由员工取消" }).where(eq(runs.id, RUN_ID));
    await db.update(approvals).set({ status: "rejected", note: "运行已取消，确认未继续" }).where(eq(approvals.id, approval.id));

    await expect(recordDecision({
      runId: RUN_ID,
      node: draft.nodes.confirm,
      approvalId: approval.id,
      decision: { decision: "approved", note: "迟到的同意" },
    })).rejects.toThrow("运行已经结束，忽略迟到的确认结果");

    const [unchanged] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
    expect(unchanged).toMatchObject({ status: "rejected", note: "运行已取消，确认未继续" });
    expect(appendTraceMock).not.toHaveBeenCalled();
  });
});
