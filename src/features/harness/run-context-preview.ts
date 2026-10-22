import { redactSensitiveData, redactSensitiveText } from "@/server/domain/security/redact-sensitive";

const INTERNAL_REFERENCES = new Set([
  "id", "runId", "parentRunId", "childRunId", "workflowRunId", "workflowId", "nodeId", "nodeIds",
  "agentId", "versionId", "workspaceId", "createdBy", "sourceId", "connectionId", "stepId", "eventKey",
]);
const CONDITION_REFERENCES = new Set([...INTERNAL_REFERENCES, "next", "matched"]);
export const CONTEXT_PREVIEW_CHARACTERS = 4_000;
export const CONTEXT_PREVIEW_ENTRIES = 10;
export const CONTEXT_PREVIEW_NODES = 80;
export const CONTEXT_PREVIEW_DEPTH = 6;

function emptyValueLabel(value: unknown): string | null {
  if (value === null) return "此项保存为空值。";
  if (value === "") return "此项保存为空文字。";
  if (Array.isArray(value) && value.length === 0) return "此项保存为空列表。";
  if (value && typeof value === "object" && Object.keys(value).length === 0) return "此项保存为空对象。";
  return null;
}

export function contextResultPreview(value: unknown, nodeType?: string) {
  let nodes = CONTEXT_PREVIEW_NODES;
  let characters = CONTEXT_PREVIEW_CHARACTERS;
  let shortened = false;
  const excluded = nodeType === "condition" ? CONDITION_REFERENCES : INTERNAL_REFERENCES;
  function limited(input: unknown, depth = 0): unknown {
    if (nodes-- <= 0 || depth >= CONTEXT_PREVIEW_DEPTH) {
      shortened = true;
      return "[预览已省略]";
    }
    if (typeof input === "string") {
      const length = Math.min(input.length, characters);
      characters -= length;
      if (length < input.length) shortened = true;
      return input.slice(0, length) + (length < input.length ? "…" : "");
    }
    if (input === null || typeof input === "number" || typeof input === "boolean") return input;
    if (Array.isArray(input)) {
      if (input.length > CONTEXT_PREVIEW_ENTRIES) shortened = true;
      return input.slice(0, CONTEXT_PREVIEW_ENTRIES).map((item) => limited(item, depth + 1));
    }
    if (typeof input === "object" && input) {
      const original = Object.entries(input);
      const entries = original.filter(([key]) => !excluded.has(key));
      if (entries.length !== original.length || entries.length > CONTEXT_PREVIEW_ENTRIES) shortened = true;
      const labels = new Set<string>();
      return Object.fromEntries(entries.slice(0, CONTEXT_PREVIEW_ENTRIES).map(([key, item], index) => {
        const safeKey = redactSensitiveText(key);
        let label = safeKey !== key ? "内容 " + (index + 1) : key.slice(0, 100);
        if (labels.has(label)) {
          shortened = true;
          label = "预览字段 " + (index + 1);
          while (labels.has(label)) label += "·";
        }
        labels.add(label);
        if (label.length < key.length) shortened = true;
        return [label, limited(item, depth + 1)];
      }));
    }
    shortened = true;
    return "[预览已省略]";
  }
  try {
    const safe = redactSensitiveData(value);
    if (JSON.stringify(safe) === undefined) return { readable: false as const };
    const preview = limited(safe);
    return { readable: true as const, value: preview, shortened, emptyLabel: emptyValueLabel(safe) };
  } catch {
    return { readable: false as const };
  }
}
