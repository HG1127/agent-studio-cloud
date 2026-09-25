import { WorkflowDraft, type WorkflowDraft as WorkflowDraftType } from "@/contracts/workflow";

const FORMAT_VERSION = 1;
export const DRAFT_RECOVERY_KEY_PREFIX = "agent-studio:workflow-draft:";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}

function fingerprint(draft: WorkflowDraftType): string {
  // 助手名称会由独立表单同步回草稿；它不应让同一画布的本地修改失去恢复资格。
  const serialized = stableJson({ ...draft, rootAgent: { ...draft.rootAgent, name: "" } });
  let hash = 2_166_136_261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${serialized.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function draftRecoveryKey(agentId: string): string {
  return `${DRAFT_RECOVERY_KEY_PREFIX}${agentId}`;
}

export function serializeDraftRecovery(savedDraft: WorkflowDraftType, localDraft: WorkflowDraftType): string {
  return JSON.stringify({ formatVersion: FORMAT_VERSION, savedFingerprint: fingerprint(savedDraft), draft: localDraft });
}

export function restoreDraftRecovery(raw: string | null, savedDraft: WorkflowDraftType): WorkflowDraftType | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as Record<string, unknown>;
    if (record.formatVersion !== FORMAT_VERSION || record.savedFingerprint !== fingerprint(savedDraft)) return null;
    const parsed = WorkflowDraft.safeParse(record.draft);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
