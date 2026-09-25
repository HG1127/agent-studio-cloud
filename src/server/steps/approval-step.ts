"use step";
// 审批步骤：requestApproval 落 approvals pending 行并把 run 置 waiting_approval；
// recordDecision 把审批决定写回 approvals 行。token 为确定性格式，供 createHook/resumeHook 服务端配对，
// 不下发给前端（前端只拿 approvalId）。
import { and, desc, eq, or, sql } from "drizzle-orm";
import { FatalError, getStepMetadata } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { ApprovalPayload } from "@/contracts/run";
import { approvals, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { approvalRecordId } from "@/server/domain/approval/approval-id";
import { selectApprovalReview } from "@/server/domain/approval/select-review";
import { redactCredentialData, redactCredentialText } from "@/server/domain/security/redact-sensitive";
import { persistStep } from "@/server/steps/run-state";
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
  recordedDecision?: {
    decision: "approved" | "rejected";
    note?: string;
  };
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
  let workflowStepId = "direct-call";
  try {
    workflowStepId = getStepMetadata().stepId;
  } catch {
    // 集成测试和运维直调不在 Workflow 上下文中，仍需得到稳定标识。
  }
  const stableApprovalId = approvalRecordId(args.runId, node.id, workflowStepId);
  const role = redactCredentialText(node.approval?.role ?? "业务负责人");
  const reason = redactCredentialText(node.approval?.reason ?? `确认「${node.title}」后流程才会继续`);
  const payload = ApprovalPayload.parse(redactCredentialData({ review: selectApprovalReview(args.outputs, args.nodes) }));
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ workspaceId: runs.workspaceId, createdBy: runs.createdBy, status: runs.status })
      .from(runs)
      .where(eq(runs.id, args.runId))
      .for("update")
      .limit(1);
    if (!run) throw new FatalError("运行记录不存在，无法发起确认");
    if (!["queued", "running", "waiting_approval", "waiting_event"].includes(run.status)) {
      throw new FatalError("运行已经结束，不能再发起确认");
    }
    const [existing] = await tx
      .select({ id: approvals.id, status: approvals.status, note: approvals.note })
      .from(approvals)
      .where(and(
        eq(approvals.runId, args.runId),
        or(
          eq(approvals.id, stableApprovalId),
          and(eq(approvals.nodeId, node.id), eq(approvals.status, "pending")),
        ),
      ))
      .orderBy(desc(approvals.createdAt))
      .limit(1);
    if (existing) {
      if (existing.status === "pending" && run.status !== "waiting_approval") {
        await tx.update(runs).set({ status: "waiting_approval", updatedAt: now }).where(eq(runs.id, args.runId));
      }
      return { row: existing };
    }
    const [created] = await tx
      .insert(approvals)
      .values({
        id: stableApprovalId,
        runId: args.runId,
        workspaceId: run.workspaceId,
        createdBy: run.createdBy,
        nodeId: node.id,
        nodeTitle: node.title,
        status: "pending",
        role,
        reason,
        payload,
      })
      .returning({ id: approvals.id, status: approvals.status, note: approvals.note });
    await tx.update(runs).set({ status: "waiting_approval", updatedAt: now }).where(eq(runs.id, args.runId));
    return { row: created };
  });
  if (result.row.status === "pending") {
    await appendTrace({
      runId: args.runId,
      nodeId: node.id,
      kind: "approval.requested",
      title: `等待「${node.title}」确认`,
      detail: reason,
      data: { approvalId: result.row.id, role },
      dedupeKey: `approval-requested:${result.row.id}`,
    });
  }
  const recordedDecision: ApprovalHandle["recordedDecision"] = result.row.status === "approved" || result.row.status === "rejected"
    ? {
        decision: result.row.status,
        ...(result.row.note ? { note: redactCredentialText(result.row.note) } : {}),
      }
    : undefined;
  if (!recordedDecision) {
    await persistStep({
      runId: args.runId,
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status: "running",
    });
  }
  return { approvalId: result.row.id, token: `approval:${result.row.id}`, recordedDecision };
}

export async function recordDecision(args: RecordDecisionInput): Promise<{
  approvalId: string;
  decision: "approved" | "rejected";
  note: string | null;
}> {
  "use step";
  const approved = args.decision.decision === "approved";
  const decisionStatus = approved ? "approved" : "rejected";
  const note = args.decision.note ? redactCredentialText(args.decision.note) : null;
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
        note,
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
    detail: note,
    dedupeKey: `approval-decided:${args.approvalId}:${decisionStatus}`,
  });
  const output = {
    approvalId: args.approvalId,
    decision: args.decision.decision,
    note,
  };
  await persistStep({
    runId: args.runId,
    nodeId: args.node.id,
    nodeTitle: args.node.title,
    nodeType: args.node.type,
    status: "succeeded",
    output,
  });
  return output;
}
