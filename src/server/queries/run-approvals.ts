import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ApprovalPayload, RunStatus } from "@/contracts/run";
import { RunApprovalDetail, RunApprovalListInput, RunApprovalListResult, RunApprovalReference } from "@/contracts/run-approval";
import { approvals, runs, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { approvalTaskState } from "@/server/domain/approval/decision-policy";
import { redactCredentialData, redactCredentialText, redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";

function consumedCondition() {
  return sql<boolean>`exists(select 1 from ${traceEvents} where ${traceEvents.runId} = ${approvals.runId} and ${traceEvents.workspaceId} = ${approvals.workspaceId} and ${traceEvents.kind} = 'approval.decided' and ${traceEvents.data} ->> '_dedupeKey' = 'approval-decided:' || ${approvals.id}::text || ':' || ${approvals.status})`;
}

export async function getRunApproval(runId: string, approvalId: string, workspaceId: string) {
  RunApprovalReference.parse({ runId, approvalId });
  z.string().uuid().parse(workspaceId);
  const [row] = await db.select({ approval: approvals, runStatus: runs.status, consumed: consumedCondition() }).from(approvals)
    .innerJoin(runs, and(eq(runs.id, approvals.runId), eq(runs.workspaceId, approvals.workspaceId)))
    .where(and(eq(approvals.id, approvalId), eq(approvals.runId, runId), eq(approvals.workspaceId, workspaceId))).limit(1);
  if (!row) return { kind: "missing" as const };
  const parsed = ApprovalPayload.safeParse(row.approval.payload ?? { review: null });
  if (!parsed.success) return { kind: "unavailable" as const };
  const payload = redactCredentialData(parsed.data) as ApprovalPayload;
  if (parsed.data.review?.format === "json") payload.review = { ...payload.review!, content: JSON.stringify(redactStructuredCredentialData(JSON.parse(parsed.data.review.content))) };
  const status = RunStatus.parse(row.runStatus);
  const result = RunApprovalDetail.safeParse({
    ...row.approval, runStatus: status, state: approvalTaskState(row.approval.status, status, row.consumed), decisionConsumed: row.consumed,
    nodeTitle: redactCredentialText(row.approval.nodeTitle),
    role: redactCredentialText(row.approval.role), reason: redactCredentialText(row.approval.reason), review: payload.review,
    note: row.approval.note ? redactCredentialText(row.approval.note) : null,
    createdAt: row.approval.createdAt.toISOString(), decidedAt: row.approval.decidedAt?.toISOString() ?? null,
  });
  return result.success ? { kind: "found" as const, approval: result.data } : { kind: "unavailable" as const };
}

export async function listRunApprovals(runId: string, workspaceId: string, input: RunApprovalListInput): Promise<RunApprovalListResult | null> {
  z.string().uuid().parse(runId);
  z.string().uuid().parse(workspaceId);
  const filters = RunApprovalListInput.parse(input);
  const [run] = await db.select({ status: runs.status }).from(runs).where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId))).limit(1);
  if (!run) return null;
  const status = RunStatus.parse(run.status);
  const before = filters.before ? sql`${filters.before}::timestamptz` : undefined;
  const rows = await db.select({
    id: approvals.id, runId: approvals.runId, nodeTitle: sql<string>`left(${approvals.nodeTitle}, 500)`, titleTruncated: sql<boolean>`length(${approvals.nodeTitle}) > 500`,
    status: approvals.status, createdAt: approvals.createdAt, decidedAt: approvals.decidedAt, decisionConsumed: consumedCondition(),
    cursorCreatedAt: sql<string>`to_char(${approvals.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }).from(approvals).where(and(eq(approvals.runId, runId), eq(approvals.workspaceId, workspaceId),
    filters.status ? eq(approvals.status, filters.status) : undefined,
    before && filters.beforeId ? or(lt(approvals.createdAt, before), and(eq(approvals.createdAt, before), lt(approvals.id, filters.beforeId))) : undefined,
  )).orderBy(desc(approvals.createdAt), desc(approvals.id)).limit(filters.limit + 1);
  const selected = rows.slice(0, filters.limit);
  const last = selected.at(-1);
  return RunApprovalListResult.parse({ ok: true, runId,
    items: selected.map((row) => {
      const title = redactCredentialText(row.nodeTitle);
      return { ...row, nodeTitle: title.slice(0, 500), titleTruncated: row.titleTruncated || title.length > 500,
        runStatus: status, state: approvalTaskState(row.status, status, row.decisionConsumed), createdAt: row.createdAt.toISOString(), decidedAt: row.decidedAt?.toISOString() ?? null };
    }),
    nextCursor: rows.length > filters.limit && last ? { createdAt: last.cursorCreatedAt, id: last.id } : null,
  });
}
