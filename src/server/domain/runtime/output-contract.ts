import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { safeDataPathSegments } from "@/server/domain/runtime/data-path";
import { hasMeaningfulResult } from "@/server/domain/runtime/result-content";

type OutputField = NonNullable<WorkflowDraft["outputContract"]>["fields"][number];

export function rejectedWorkflowResult(decision: unknown): Record<string, unknown> | null {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return null;
  const record = decision as Record<string, unknown>;
  if (record.decision !== "rejected") return null;
  const note = record.note;
  return {
    处理状态: "未获确认",
    说明: "负责人未批准，本次运行已安全停止，后续交付没有执行",
    ...(typeof note === "string" && note.trim() ? { 确认备注: note.trim() } : {}),
  };
}

export function validateOutputFieldPaths(fields: OutputField[]): string | null {
  const paths = fields.map((field) => field.path.trim());
  if (paths.some((path) => !safeDataPathSegments(path))) return "最终交付字段位置不能使用保留名称";
  if (paths.some((path) => !/^[\p{L}_][\p{L}\p{N}_-]*(?:\.[\p{L}_][\p{L}\p{N}_-]*)*$/u.test(path))) {
    return "最终交付字段位置格式不正确";
  }
  if (new Set(paths).size !== paths.length) return "最终交付字段位置不能重复";
  const ordered = [...paths].sort();
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered.some((path, position) => position !== index && path.startsWith(`${ordered[index]}.`))) {
      return `最终交付字段位置“${ordered[index]}”与其下级字段冲突`;
    }
  }
  return null;
}

export function validateOutputContract(fields: OutputField[], nodes: Record<string, WorkflowNode>): string | null {
  const pathError = validateOutputFieldPaths(fields);
  if (pathError) return pathError;
  for (const field of fields) {
    const sourceId = field.sourceNodeId ?? field.path.split(".")[0];
    const source = nodes[sourceId];
    if (!source || source.type === "trigger" || source.type === "end" || source.ui?.visibility === "control") {
      return `最终交付“${field.label || field.path}”必须选择有效的业务步骤来源`;
    }
  }
  return null;
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  const parts = safeDataPathSegments(path.replace(/^(?:context\.)?outputs\./, ""));
  if (!parts) return undefined;
  return parts.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): boolean {
  const parts = safeDataPathSegments(path);
  if (!parts) return false;
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
  return true;
}

export function projectWorkflowResult(outputs: Record<string, unknown>, fields: OutputField[]):
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; missing: string[] } {
  if (fields.length === 0) return { ok: true, result: outputs };
  const result: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const field of fields) {
    if (!safeDataPathSegments(field.path)) {
      if (field.required) missing.push(field.label || field.path);
      continue;
    }
    const value = field.sourceNodeId ? outputs[field.sourceNodeId] : readPath(outputs, field.path);
    if (!hasMeaningfulResult(value)) {
      if (field.required) missing.push(field.label || field.path);
      continue;
    }
    if (!writePath(result, field.path, value) && field.required) missing.push(field.label || field.path);
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, result };
}
