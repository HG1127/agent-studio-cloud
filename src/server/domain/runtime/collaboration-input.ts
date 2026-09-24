import type { AgentManifest } from "@/contracts/manifest";
import { RunInputPayload } from "@/contracts/run";
import { validateRunInput } from "@/server/domain/runtime/run-input";

export const MAX_COLLABORATION_CONTEXT_CHARS = 24_000;
const TRUNCATION_MARKER = "\n…[协作上下文过长，已截断]…\n";

export function buildBoundedCollaborationContext(value: unknown, copies = 1): string {
  const raw = JSON.stringify(value);
  const budget = Math.max(200, Math.floor(MAX_COLLABORATION_CONTEXT_CHARS / Math.max(1, copies)));
  if (raw.length <= budget) return raw;
  const available = budget - TRUNCATION_MARKER.length;
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${raw.slice(0, head)}${TRUNCATION_MARKER}${raw.slice(raw.length - tail)}`;
}

export function validateCollaborationInput(
  value: Record<string, unknown>,
  fields: AgentManifest["inputContract"]["fields"],
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const parsed = RunInputPayload.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "协作输入格式不正确" };
  }
  const contractError = validateRunInput(parsed.data, fields);
  return contractError ? { ok: false, error: contractError } : { ok: true, data: parsed.data };
}
