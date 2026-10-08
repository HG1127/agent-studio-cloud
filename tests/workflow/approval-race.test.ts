import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { waitForHook } from "@workflow/vitest";
import { resumeHook, start } from "workflow/api";
import { approvals, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { decideApprovalAction } from "@/server/actions/decide-approval";
import { WorkflowNode } from "@/contracts/workflow";
import { approvalRegistrationRaceWorkflow } from "./approval-race.fixture";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("审批入口注册前的快速确认", () => {
  it("恢复消息尚未就绪时保留决定，入口注册后自动继续且无需再次点击", async () => {
    const [run] = await db.insert(runs).values({
      workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: "00000000-0000-4000-8000-0000000000fa", versionId: "00000000-0000-4000-8000-0000000000fb",
      status: "queued", input: {},
    }).returning({ id: runs.id });
    const node = WorkflowNode.parse({ id: "confirm", title: "确认处理方案", type: "human", next: null });
    const handle = await start(approvalRegistrationRaceWorkflow, [{ runId: run.id, node, nodes: { confirm: node }, outputs: {} }]);
    const gateToken = `test-approval-registration:${run.id}`;
    await waitForHook(handle, { token: gateToken });
    let approvalId: string | undefined;
    const deadline = Date.now() + 90_000;
    while (!approvalId && Date.now() < deadline) {
      const [row] = await db.select({ id: approvals.id }).from(approvals)
        .where(and(eq(approvals.runId, run.id), eq(approvals.status, "pending"))).limit(1);
      approvalId = row?.id;
      if (!approvalId) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(approvalId).toBeDefined();
    const earlyDecision = await decideApprovalAction(run.id, approvalId!, { decision: "approved", note: "快速确认" });
    await resumeHook(gateToken, true);
    expect(earlyDecision).toMatchObject({ ok: false, saved: true });
    await expect(handle.returnValue).resolves.toEqual({ approvalId, decision: "approved", note: "快速确认" });
    const [saved] = await db.select().from(approvals).where(eq(approvals.id, approvalId!)).limit(1);
    expect(saved).toMatchObject({ status: "approved", note: "快速确认" });
  }, 240_000);
});
