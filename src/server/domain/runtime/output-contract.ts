import type { WorkflowDraft } from "@/contracts/workflow";

type OutputField = NonNullable<WorkflowDraft["outputContract"]>["fields"][number];

function readPath(value: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/^(?:context\.)?outputs\./, "").split(".").filter(Boolean);
  return parts.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function writePath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let current = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value;
      return;
    }
    const child = current[part];
    if (!child || typeof child !== "object" || Array.isArray(child)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  });
}

export function projectWorkflowResult(outputs: Record<string, unknown>, fields: OutputField[]):
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; missing: string[] } {
  if (fields.length === 0) return { ok: true, result: outputs };
  const result: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const field of fields) {
    const value = field.sourceNodeId ? outputs[field.sourceNodeId] : readPath(outputs, field.path);
    if (value === undefined || value === null) {
      if (field.required) missing.push(field.label || field.path);
      continue;
    }
    writePath(result, field.path, value);
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, result };
}
