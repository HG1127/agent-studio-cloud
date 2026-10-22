import { z } from "zod";
import type { HarnessPolicy, HarnessSubject } from "@/contracts/harness";
import {
  HarnessManagedPolicy, HarnessPolicyRecord, HarnessPolicySnapshot, HarnessPolicyView,
  type HarnessPolicyEvaluation,
} from "@/contracts/harness-management";
import { evaluateHarnessPolicy } from "@/server/domain/harness/policy";
import { redactCredentialText } from "@/server/domain/security/redact-sensitive";

export class HarnessPolicyDataError extends Error {
  constructor() { super("运行规则配置或冻结记录无效，已阻止模型和工具调用"); }
}

export function containsManagedHarnessCredential(value: string): boolean {
  return redactCredentialText(value) !== value || /\bpat_[0-9a-f]{64}\b/i.test(value);
}

export function validateManagedHarnessPolicy(raw: unknown): HarnessManagedPolicy {
  const parsed = HarnessManagedPolicy.safeParse(raw);
  if (!parsed.success) throw new HarnessPolicyDataError();
  if (parsed.data !== null) {
    for (const rule of parsed.data.rules) {
      for (const value of [rule.id, rule.reason, ...Object.values(rule.when)]) {
        if (typeof value === "string" && containsManagedHarnessCredential(value)) throw new HarnessPolicyDataError();
      }
    }
  }
  return parsed.data;
}

export function presentHarnessPolicy(raw: unknown): HarnessPolicyView {
  if (raw === null) return HarnessPolicyView.parse({ revision: 0, source: "unconfigured", policy: null, updatedAt: null });
  const row = HarnessPolicyRecord.safeParse(raw);
  if (!row.success || row.data.archivedAt !== null) throw new HarnessPolicyDataError();
  const policy = validateManagedHarnessPolicy(row.data.policy);
  return HarnessPolicyView.parse({ revision: row.data.revision, source: policy === null ? "cleared" : "configured", policy, updatedAt: row.data.updatedAt.toISOString() });
}

export function freezeWorkspaceHarnessPolicy(workspaceId: string, view: HarnessPolicyView, now: Date): HarnessPolicySnapshot {
  const parsed = HarnessPolicyView.safeParse(view);
  if (!parsed.success || !Number.isFinite(now.getTime())) throw new HarnessPolicyDataError();
  const snapshot = HarnessPolicySnapshot.safeParse({ version: 1, workspaceId, revision: parsed.data.revision,
    policy: validateManagedHarnessPolicy(parsed.data.policy), frozenAt: now.toISOString() });
  if (!snapshot.success) throw new HarnessPolicyDataError();
  return snapshot.data;
}

export function readFrozenHarnessPolicy(workspaceId: string, raw: unknown): HarnessPolicySnapshot | null {
  if (!z.uuid().safeParse(workspaceId).success) throw new HarnessPolicyDataError();
  // null 是历史管理员规则覆盖，不读取后来保存的工作区规则。
  if (raw === null) return null;
  const snapshot = HarnessPolicySnapshot.safeParse(raw);
  if (!snapshot.success || snapshot.data.workspaceId !== workspaceId) throw new HarnessPolicyDataError();
  validateManagedHarnessPolicy(snapshot.data.policy);
  return snapshot.data;
}

export function inheritHarnessPolicySnapshot(workspaceId: string, parent: { workspaceId: string; snapshot: unknown } | null): HarnessPolicySnapshot | null {
  if (!parent || parent.workspaceId !== workspaceId) throw new HarnessPolicyDataError();
  return readFrozenHarnessPolicy(workspaceId, parent.snapshot);
}

export function evaluateFrozenHarnessPolicy(args: {
  administrator: HarnessPolicy | null; workspaceId: string; snapshot: unknown; subject: HarnessSubject;
}): HarnessPolicyEvaluation {
  if (args.administrator === null) return { allowed: false, source: "administrator", invalid: true };
  if (!evaluateHarnessPolicy(args.administrator, args.subject).allowed) return { allowed: false, source: "administrator", invalid: false };
  try {
    const snapshot = readFrozenHarnessPolicy(args.workspaceId, args.snapshot);
    if (snapshot === null) return { allowed: true, source: "legacy", invalid: false };
    return { allowed: snapshot.policy === null || evaluateHarnessPolicy(snapshot.policy, args.subject).allowed, source: "workspace", invalid: false };
  } catch {
    return { allowed: false, source: "workspace", invalid: true };
  }
}
