import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

const { cancelMock, getRunMock, revalidatePathMock } = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  getRunMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));
vi.mock("workflow/api", () => ({ getRun: getRunMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { approvals, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { cancelRunAction } from "@/server/actions/cancel-run";

const RUN_ID = "00000000-0000-4000-8000-0000000000c1";

afterEach(async () => {
  cancelMock.mockReset();
  getRunMock.mockReset();
  revalidatePathMock.mockReset();
  await db.delete(approvals).where(eq(approvals.runId, RUN_ID));
  await db.delete(runs).where(eq(runs.id, RUN_ID));
});

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
});
