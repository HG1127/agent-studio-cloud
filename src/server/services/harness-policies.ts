import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  HarnessPolicySaveInput, HarnessPolicySaveResult, type HarnessPolicySnapshot, type HarnessPolicyView,
} from "@/contracts/harness-management";
import { harnessPolicies, harnessPolicyChanges, runs, type Run } from "@/db/schema";
import { db } from "@/lib/db";
import { canonicalJson } from "@/server/domain/canonical-json";
import {
  HarnessPolicyDataError, containsManagedHarnessCredential, freezeWorkspaceHarnessPolicy, inheritHarnessPolicySnapshot,
  presentHarnessPolicy, readFrozenHarnessPolicy, validateManagedHarnessPolicy,
} from "@/server/domain/harness/management";

type HarnessTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class HarnessPolicyConflict extends Error {}

export async function lockHarnessWorkspace(tx: HarnessTransaction, workspaceId: string): Promise<void> {
  if (!z.uuid().safeParse(workspaceId).success) throw new HarnessPolicyDataError();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`harness-policy:${workspaceId.toLowerCase()}`}, 0))`);
}

export async function readWorkspaceHarnessPolicy(tx: Pick<HarnessTransaction, "select">, workspaceId: string): Promise<HarnessPolicyView> {
  if (!z.uuid().safeParse(workspaceId).success) throw new HarnessPolicyDataError();
  const [row] = await tx.select({ id: harnessPolicies.id, revision: harnessPolicies.revision, policy: harnessPolicies.policy,
    updatedAt: harnessPolicies.updatedAt, archivedAt: harnessPolicies.archivedAt })
    .from(harnessPolicies).where(eq(harnessPolicies.workspaceId, workspaceId)).limit(1);
  return presentHarnessPolicy(row ?? null);
}

export async function saveManagedHarnessPolicy(raw: HarnessPolicySaveInput, workspaceId: string, createdBy: string): Promise<HarnessPolicySaveResult> {
  if (!z.uuid().safeParse(workspaceId).success || !z.uuid().safeParse(createdBy).success) throw new HarnessPolicyDataError();
  const input = HarnessPolicySaveInput.parse(raw);
  validateManagedHarnessPolicy(input.policy);
  if (containsManagedHarnessCredential(input.reason)) throw new HarnessPolicyDataError();
  const requestHash = createHash("sha256").update(canonicalJson(input)).digest("hex");
  return db.transaction(async (tx) => {
    await lockHarnessWorkspace(tx, workspaceId);
    const match = eq(harnessPolicies.workspaceId, workspaceId);
    const [row] = await tx.select({ id: harnessPolicies.id, revision: harnessPolicies.revision, policy: harnessPolicies.policy,
      updatedAt: harnessPolicies.updatedAt, archivedAt: harnessPolicies.archivedAt }).from(harnessPolicies).where(match).for("update").limit(1);
    const current = presentHarnessPolicy(row ?? null);
    const [previous] = await tx.select({ requestHash: harnessPolicyChanges.requestHash, revision: harnessPolicyChanges.revision })
      .from(harnessPolicyChanges).where(and(eq(harnessPolicyChanges.workspaceId, workspaceId), eq(harnessPolicyChanges.requestId, input.requestId))).limit(1);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new HarnessPolicyConflict("同一次运行规则请求不能更换内容或版本");
      return HarnessPolicySaveResult.parse({ ok: true, recordedRevision: previous.revision, policy: current });
    }
    if (current.revision !== input.expectedRevision) throw new HarnessPolicyConflict("运行规则已被更新，请刷新后再提交");
    const now = new Date(), revision = current.revision + 1;
    const [saved] = row
      ? await tx.update(harnessPolicies).set({ policy: input.policy, revision, updatedAt: now })
        .where(and(match, eq(harnessPolicies.id, row.id), eq(harnessPolicies.revision, current.revision))).returning({ id: harnessPolicies.id })
      : await tx.insert(harnessPolicies).values({ workspaceId, createdBy, policy: input.policy, revision, createdAt: now, updatedAt: now }).returning({ id: harnessPolicies.id });
    if (!saved) throw new HarnessPolicyConflict("运行规则已被更新，请刷新后再提交");
    await tx.insert(harnessPolicyChanges).values({ workspaceId, createdBy, policyId: saved.id, requestId: input.requestId,
      requestHash, revision, previousPolicy: current.policy, policy: input.policy, reason: input.reason, createdAt: now, updatedAt: now });
    return HarnessPolicySaveResult.parse({ ok: true, recordedRevision: revision,
      policy: presentHarnessPolicy({ id: saved.id, revision, policy: input.policy, updatedAt: now, archivedAt: null }) });
  });
}

export async function freezeRunHarnessPolicy(tx: HarnessTransaction,
  run: Pick<Run, "workspaceId" | "parentRunId" | "sourceType" | "harnessPolicySnapshot">, now: Date): Promise<HarnessPolicySnapshot | null> {
  if (run.harnessPolicySnapshot !== null) throw new HarnessPolicyDataError();
  if (run.parentRunId !== null) {
    const [parent] = await tx.select({ workspaceId: runs.workspaceId, snapshot: runs.harnessPolicySnapshot, status: runs.status })
      .from(runs).where(and(eq(runs.id, run.parentRunId), eq(runs.workspaceId, run.workspaceId))).limit(1);
    if (!parent || !["running", "waiting_approval", "waiting_event", "waiting_review", "completed", "failed", "cancelled"].includes(parent.status)) throw new HarnessPolicyDataError();
    return inheritHarnessPolicySnapshot(run.workspaceId, parent);
  }
  if (run.sourceType === "agent_call" || run.sourceType === "handoff") throw new HarnessPolicyDataError();
  if (!["manual", "schedule", "evaluation"].includes(run.sourceType)) throw new HarnessPolicyDataError();
  await lockHarnessWorkspace(tx, run.workspaceId);
  return freezeWorkspaceHarnessPolicy(run.workspaceId, await readWorkspaceHarnessPolicy(tx, run.workspaceId), now);
}

export async function readRunHarnessPolicy(runId: string): Promise<{ workspaceId: string; snapshot: HarnessPolicySnapshot | null }> {
  if (!z.uuid().safeParse(runId).success) throw new HarnessPolicyDataError();
  // 运行标识来自受控步骤；只读取该运行的工作区和冻结内容，不读取当前管理配置。
  const [run] = await db.select({ workspaceId: runs.workspaceId, snapshot: runs.harnessPolicySnapshot }).from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new HarnessPolicyDataError();
  return { workspaceId: run.workspaceId, snapshot: readFrozenHarnessPolicy(run.workspaceId, run.snapshot) };
}
