import { WorkflowOutputField, type WorkflowNode } from "@/contracts/workflow";
import { InlineOutputReferences } from "@/contracts/inline-output-reference";
import { boundedJsonStorageValue, isPassiveJsonData } from "@/contracts/json";
import { MAX_RUN_RESULT_BYTES } from "@/contracts/run";
import { safeDataPathSegments } from "@/server/domain/runtime/data-path";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { hasMeaningfulResult } from "@/server/domain/runtime/result-content";
import { isCredentialFieldName } from "@/server/domain/security/redact-sensitive";
import { prepareSubflow } from "./subflow-runtime";
import { prepareParallelBranches } from "./parallel-runtime";
import { readInlineOutput } from "./inline-output-references";

type OutputField = WorkflowOutputField;
const SelectedResultValue = boundedJsonStorageValue(MAX_RUN_RESULT_BYTES, "最终交付字段");

export function workflowOutputSourceNodes(nodes: Record<string, WorkflowNode>): Record<string, WorkflowNode> {
  const sources = { ...nodes };
  for (const node of Object.values(nodes)) {
    if (isHiddenControlNode(node)) continue;
    if (node.type === "subflow") {
      const prepared = prepareSubflow(node);
      if (prepared.ok) for (const step of prepared.steps) sources[step.id] = step;
    } else if (node.type === "parallel") {
      const prepared = prepareParallelBranches(node);
      if (prepared.ok) for (const branch of prepared.branches) for (const step of branch.steps) sources[step.id] = step;
    }
  }
  return sources;
}

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
  const sources = workflowOutputSourceNodes(nodes);
  for (const field of fields) {
    if (!WorkflowOutputField.safeParse(field).success) return `最终交付“${field.label || field.path}”的来源字段配置无效`;
    if (field.sourcePath?.some(isCredentialFieldName)) return `最终交付“${field.label || field.path}”不能选择凭据来源字段`;
    const sourceId = field.sourceNodeId ?? field.path.split(".")[0];
    const source = Object.prototype.hasOwnProperty.call(sources, sourceId) ? sources[sourceId] : undefined;
    if (
      !source
      || source.type === "trigger"
      || source.type === "end"
      || isHiddenControlNode(source)
    ) {
      return `最终交付“${field.label || field.path}”必须选择有效的业务步骤来源`;
    }
  }
  return null;
}

function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function readSourcePath(value: unknown, segments: string[]): unknown {
  return segments.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    if (Array.isArray(current) && (!/^(?:0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(Number(key)) || Number(key) >= current.length)) return undefined;
    return ownData(current, key);
  }, value);
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  const parts = safeDataPathSegments(path.replace(/^(?:context\.)?outputs\./, ""));
  if (!parts) return undefined;
  return readSourcePath(value, parts);
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

export function projectWorkflowResult(outputs: Record<string, unknown>, fields: OutputField[], inlineReferences?: InlineOutputReferences):
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; missing: string[] } {
  if (fields.length === 0) return { ok: true, result: outputs };
  const references = InlineOutputReferences.safeParse(inlineReferences ?? {});
  if (!references.success) return { ok: false, missing: ["最终交付来源定位无效"] };
  if (validateOutputFieldPaths(fields)) {
    const required = fields.filter((field) => field.required).map((field) => field.label || field.path);
    return { ok: false, missing: required.length ? required : ["最终交付字段配置无效"] };
  }
  const result: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const candidate of fields) {
    const configuration = WorkflowOutputField.safeParse(candidate);
    if (!configuration.success || configuration.data.sourcePath?.some(isCredentialFieldName)) return { ok: false, missing: [candidate.label || candidate.path] };
    const field = configuration.data;
    const source = field.sourceNodeId
      ? Object.hasOwn(outputs, field.sourceNodeId) ? ownData(outputs, field.sourceNodeId) : readInlineOutput(field.sourceNodeId, outputs, references.data)
      : undefined;
    const value = field.sourceNodeId
      ? ownData(source, "status") === "failed" || ownData(source, "ok") === false ? undefined : readSourcePath(source, field.sourcePath ?? [])
      : readPath(outputs, field.path);
    if (value === undefined || value === null) {
      if (field.required) missing.push(field.label || field.path);
      continue;
    }
    if (!isPassiveJsonData(value, MAX_RUN_RESULT_BYTES)) return { ok: false, missing: [field.label || field.path] };
    const parsed = SelectedResultValue.safeParse(value);
    if (!parsed.success) return { ok: false, missing: [field.label || field.path] };
    const copied = JSON.parse(JSON.stringify(parsed.data));
    if (!hasMeaningfulResult(copied)) {
      if (field.required) missing.push(field.label || field.path);
      continue;
    }
    if (!writePath(result, field.path, copied) && field.required) missing.push(field.label || field.path);
    if (!SelectedResultValue.safeParse(result).success) return { ok: false, missing: ["最终交付内容无效或超过容量限制"] };
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, result };
}
