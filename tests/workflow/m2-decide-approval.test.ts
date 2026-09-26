import { eq } from "drizzle-orm";
import { afterEach, vi, describe, expect, it } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const resumeHookMock = vi.hoisted(() => vi.fn());
vi.mock("workflow/api", () => ({ resumeHook: resumeHookMock }));

import { approvals, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { decideApprovalAction } from "@/server/actions/decide-approval";

const RUN_ID = "00000000-0000-4000-8000-0000000000e5";
const APPROVAL_ID = "00000000-0000-4000-8000-0000000000e6";
const AGENT_ID = "00000000-0000-4000-8000-0000000000e7";
const VERSION_ID = "00000000-0000-4000-8000-0000000000e8";

afterEach(async () => {
  resumeHookMock.mockReset();
  await db.delete(approvals).where(eq(approvals.runId, RUN_ID));
  await db.delete(runs).where(eq(runs.id, RUN_ID));
});

async function insertPendingApproval(status = "waiting_approval") {
  await db.insert(runs).values({
    id: RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    agentId: AGENT_ID, versionId: VERSION_ID, status, input: {},
  });
  await db.insert(approvals).values({
    id: APPROVAL_ID, runId: RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    nodeId: "confirm", nodeTitle: "负责人确认处理方案", status: "pending",
    role: "业务负责人", reason: "确认处理方案后流程才会继续",
  });
}

describe("审批决定的原子性", () => {
  it("二次提交返回已处理且不再改动确认行", async () => {
    resumeHookMock.mockResolvedValue(undefined);
    await insertPendingApproval();
    const first = await decideApprovalAction(RUN_ID, APPROVAL_ID, { decision: "approved", note: "同意执行" });
    expect(first.ok).toBe(true);
    expect(resumeHookMock).toHaveBeenCalledWith(`approval:${APPROVAL_ID}`, { decision: "approved", note: "同意执行" });
    const [afterFirst] = await db.select().from(approvals).where(eq(approvals.id, APPROVAL_ID)).limit(1);
    expect(afterFirst?.status).toBe("approved");
    expect(afterFirst?.decidedAt).not.toBeNull();

    const second = await decideApprovalAction(RUN_ID, APPROVAL_ID, { decision: "rejected", note: "反悔" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("确认记录与继续请求不一致");
    const [afterSecond] = await db.select().from(approvals).where(eq(approvals.id, APPROVAL_ID)).limit(1);
    expect(afterSecond?.status).toBe("approved");
    expect(afterSecond?.note).toBe("同意执行");
    expect(afterSecond?.decidedAt?.getTime()).toBe(afterFirst?.decidedAt?.getTime());
  }, 240_000);

  it("运行已结束时拒绝处理遗留的待确认记录", async () => {
    await insertPendingApproval("cancelled");

    const result = await decideApprovalAction(RUN_ID, APPROVAL_ID, { decision: "approved" });

    expect(result).toEqual({ ok: false, error: "这次运行已不再等待确认，请刷新页面查看最新状态" });
    expect(resumeHookMock).not.toHaveBeenCalled();
    const [approval] = await db.select().from(approvals).where(eq(approvals.id, APPROVAL_ID)).limit(1);
    expect(approval.status).toBe("pending");
  });

  it("恢复结果不确定时保留已经提交的确认决定", async () => {
    await insertPendingApproval();
    resumeHookMock.mockRejectedValue(new Error("工作流响应丢失"));

    const result = await decideApprovalAction(RUN_ID, APPROVAL_ID, { decision: "approved" });

    expect(result).toEqual({
      ok: false,
      error: "确认已保留，但运行暂时无法继续，请稍后重试",
      saved: true,
    });
    const [approval] = await db.select().from(approvals).where(eq(approvals.id, APPROVAL_ID)).limit(1);
    expect(approval.status).toBe("approved");
  });

  it("确认已保存但工作流未恢复时可以按原决定继续", async () => {
    await insertPendingApproval();
    await db.update(approvals).set({
      status: "approved",
      note: "同意执行",
      decidedAt: new Date(),
    }).where(eq(approvals.id, APPROVAL_ID));
    resumeHookMock.mockResolvedValue(undefined);

    const result = await decideApprovalAction(RUN_ID, APPROVAL_ID, {
      decision: "approved",
      resumeOnly: true,
    });

    expect(result).toEqual({ ok: true });
    expect(resumeHookMock).toHaveBeenCalledWith(`approval:${APPROVAL_ID}`, {
      decision: "approved",
      note: "同意执行",
    });
  });
});
