import { and, desc, eq, lt } from "drizzle-orm";
import { AttentionIdentifier } from "@/contracts/attention-reference";
import { ExecutionPolicyHistoryInput, ExecutionPolicyHistoryResult, type ExecutionPolicySnapshot } from "@/contracts/execution-resources";
import { executionPolicyChanges } from "@/db/schema";
import { db } from "@/lib/db";
import { presentExecutionCapacity } from "@/server/domain/execution-resources";
import { redactAttentionText } from "@/server/domain/attention";
import { readExecutionCapacity, readExecutionPolicy } from "@/server/services/execution-resources";

export async function getExecutionResourcePolicy(workspaceId: string, now = new Date()): Promise<ExecutionPolicySnapshot> {
  const workspace = AttentionIdentifier.parse(workspaceId);
  return db.transaction(async (tx) => {
    const policy = await readExecutionPolicy(tx, workspace), capacity = await readExecutionCapacity(tx, workspace);
    return presentExecutionCapacity(policy, capacity, now);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function listExecutionPolicyHistory(workspaceId: string, raw: ExecutionPolicyHistoryInput): Promise<ExecutionPolicyHistoryResult> {
  const workspace = AttentionIdentifier.parse(workspaceId), input = ExecutionPolicyHistoryInput.parse(raw);
  const rows = await db.select({ id: executionPolicyChanges.id, requestId: executionPolicyChanges.requestId, revision: executionPolicyChanges.revision,
    previousLimits: executionPolicyChanges.previousLimits, limits: executionPolicyChanges.limits, reason: executionPolicyChanges.reason, createdAt: executionPolicyChanges.createdAt })
    .from(executionPolicyChanges).where(and(eq(executionPolicyChanges.workspaceId, workspace), input.beforeRevision ? lt(executionPolicyChanges.revision, input.beforeRevision) : undefined))
    .orderBy(desc(executionPolicyChanges.revision)).limit(input.limit + 1);
  const selected = rows.slice(0, input.limit);
  return ExecutionPolicyHistoryResult.parse({ ok: true, items: selected.map((row) => ({ ...row, reason: redactAttentionText(row.reason), createdAt: row.createdAt.toISOString() })),
    nextBeforeRevision: rows.length > input.limit ? selected.at(-1)!.revision : null });
}
