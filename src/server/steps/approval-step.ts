"use step";
// 审批步骤：requestApproval 落 approvals pending 行并把 run 置 waiting_approval；
// recordDecision 把审批决定写回 approvals 行。token 为确定性格式，供 createHook/resumeHook 服务端配对，
// 不下发给前端（前端只拿 approvalId）。
import { and, desc, eq, sql } from "drizzle-orm";
import { FatalError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { ApprovalPayload } from "@/contracts/run";
import { approvals, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { selectApprovalReview } from "@/server/domain/approval/select-review";
import { appendTrace } from "@/server/steps/trace-step";

export interface RequestApprovalInput {
  runId: string;
  node: WorkflowNode;
  outputs: Record<string, unknown>;
  nodes: Record<string, WorkflowNode>;
}

export interface ApprovalHandle {
  approvalId: string;
  token: string;
}

export interface RecordDecisionInput {
  runId: string;
  node: WorkflowNode;
  approvalId: string;
  decision: { decision: "approved" | "rejected"; note?: string };
}

export async function requestApproval(args: RequestApprovalInput): Promise<ApprovalHandle> {
  "use step";
  const node = args.node;
  const role = node.approval?.role ?? "业务负责人";
  const reason = node.approval?.reason ?? `确认「${node.title}」后流程才会继续`;
  const payload = ApprovalPayload.parse({ review: selectApprovalReview(args.outputs, args.nodes) });
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ workspaceId: runs.workspaceId, status: runs.status })
      .from(runs)
      .where(eq(runs.id, args.runId))
      .for("update")
      .limit(1);
    if (!run) throw new FatalError("运行记录不存在，无法发起确认");
    if (!["queued", "running", "waiting_approval", "waiting_event"].includes(run.status)) {
      throw new FatalError("运行已经结束，不能再发起确认");
    }
    const [existing] = await tx
      .select({ id: approvals.id, status: approvals.status })
      .from(approvals)
      .where(and(eq(approvals.runId, args.runId), eq(approvals.nodeId, node.id)))
      .orderBy(desc(approvals.createdAt))
      .limit(1);
    if (existing?.status === "pending") {
      if (run.status !== "waiting_approval") {
        await tx.update(runs).set({ status: "waiting_approval", updatedAt: now }).where(eq(runs.id, args.runId));
      }
      return { row: existing, created: false };
    }
    const [created] = await tx
      .insert(approvals)
      .values({
        runId: args.runId,
        workspaceId: run.workspaceId,
        nodeId: node.id,
        nodeTitle: node.title,
        status: "pending",
        role,
        reason,
        payload,
      })
      .returning({ id: approvals.id });
    await tx.update(runs).set({ status: "waiting_approval", updatedAt: now }).where(eq(runs.id, args.runId));
    return { row: created, created: true };
  });
  if (result.created) {
    await appendTrace({
      runId: args.runId,
      nodeId: node.id,
      kind: "approval.requested",
      title: `等待「${node.title}」确认`,
      detail: reason,
      data: { approvalId: result.row.id, role },
    });
  }
  return { approvalId: result.row.id, token: `approval:${result.row.id}` };
}

export async function recordDecision(args: RecordDecisionInput): Promise<void> {
  "use step";
  const approved = args.decision.decision === "approved";
  const decisionStatus = approved ? "approved" : "rejected";
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, args.runId))
      .for("update")
      .limit(1);
    if (!run) throw new FatalError("运行记录不存在，无法记录确认结果");
    if (!["queued", "running", "waiting_approval", "waiting_event"].includes(run.status)) {
      throw new FatalError("运行已经结束，忽略迟到的确认结果");
    }
    const [approval] = await tx
      .select({ status: approvals.status })
      .from(approvals)
      .where(and(eq(approvals.id, args.approvalId), eq(approvals.runId, args.runId)))
      .limit(1);
    if (!approval) throw new FatalError("确认记录不存在，无法记录结果");
    if (approval.status === decisionStatus) return;
    if (approval.status !== "pending") throw new FatalError("这条确认已经处理，忽略迟到的结果");
    await tx
      .update(approvals)
      .set({
        status: decisionStatus,
        note: args.decision.note ?? null,
        decidedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(approvals.id, args.approvalId), eq(approvals.status, "pending")));
  });
  await appendTrace({
    runId: args.runId,
    nodeId: args.node.id,
    kind: "approval.decided",
    level: approved ? "info" : "warn",
    title: approved ? `「${args.node.title}」已确认` : `「${args.node.title}」未获确认`,
    detail: args.decision.note ?? null,
  });
}
