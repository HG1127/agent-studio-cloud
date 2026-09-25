import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import { buildBoundedCollaborationContext } from "@/server/domain/runtime/collaboration-input";
import { isSafeDataPathSegment, safeDataPathSegments } from "@/server/domain/runtime/data-path";

const SECRET_KEY = /password|passcode|secret|token|api[_-]?key|credential|cookie|authorization|private[_-]?key|密码|密钥|令牌|凭证|授权|私钥/i;

function normalizedTerms(node: WorkflowNode): string[] {
  return (node.contract?.mustNotInclude ?? [])
    .map((term) => term.toLowerCase().replace(/[\s_-]/g, ""))
    .filter((term) => term.length >= 2);
}

function ownValue(source: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

export function sanitizeHandoffValue(
  value: unknown,
  mustNotInclude: string[],
  path = "",
): { value: unknown; redactedPaths: string[] } {
  const terms = mustNotInclude
    .map((term) => term.toLowerCase().replace(/[\s_-]/g, ""))
    .filter((term) => term.length >= 2);
  const visit = (current: unknown, currentPath: string): { value: unknown; redactedPaths: string[] } => {
    if (Array.isArray(current)) {
      const rows = current.map((item, index) => visit(item, `${currentPath}[${index}]`));
      return { value: rows.map((row) => row.value), redactedPaths: rows.flatMap((row) => row.redactedPaths) };
    }
    if (!current || typeof current !== "object") return { value: current, redactedPaths: [] };
    const output: Record<string, unknown> = {};
    const redactedPaths: string[] = [];
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const keyPath = currentPath ? `${currentPath}.${key}` : key;
      if (!isSafeDataPathSegment(key)) {
        redactedPaths.push(keyPath);
        continue;
      }
      const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, "");
      if (SECRET_KEY.test(key) || terms.some((term) => normalizedKey.includes(term) || (normalizedKey.length >= 2 && term.includes(normalizedKey)))) {
        redactedPaths.push(keyPath);
        continue;
      }
      const visited = visit(child, keyPath);
      output[key] = visited.value;
      redactedPaths.push(...visited.redactedPaths);
    }
    return { value: output, redactedPaths };
  };
  return visit(value, path);
}

export function buildHandoffInput(args: {
  node: WorkflowNode;
  targetManifest: AgentManifest;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
}): { input: Record<string, unknown>; redactedPaths: string[] } {
  const terms = normalizedTerms(args.node);
  const sanitizedInput = sanitizeHandoffValue(args.input, terms);
  const sanitizedOutputs = sanitizeHandoffValue(args.outputs, terms);
  const sourceInput = sanitizedInput.value as Record<string, unknown>;
  const sourceOutputs = sanitizedOutputs.value as Record<string, unknown>;
  const fields = args.targetManifest.inputContract.fields;
  const fallbackCopies = fields.filter((field) => {
    const value = ownValue(sourceInput, field.name) ?? ownValue(sourceOutputs, field.name);
    return (value === undefined || value === null) && field.type === "string";
  }).length;
  const context = buildBoundedCollaborationContext({
    task: sourceInput,
    previousResults: Object.values(sourceOutputs),
    handoff: {
      request: args.node.description || args.node.title,
      deliverables: args.node.contract?.deliverables ?? [],
      mustNotInclude: args.node.contract?.mustNotInclude ?? [],
    },
  }, fallbackCopies || 1);
  const input = fields.length === 0 ? { brief: context } : Object.fromEntries(fields.flatMap((field) => {
    const value = ownValue(sourceInput, field.name) ?? ownValue(sourceOutputs, field.name);
    if (value !== undefined && value !== null) return [[field.name, value]];
    return field.type === "string" ? [[field.name, context]] : [];
  }));
  return { input, redactedPaths: [...sanitizedInput.redactedPaths, ...sanitizedOutputs.redactedPaths] };
}

export function validateHandoffNode(node: WorkflowNode, currentAgentId?: string): string | null {
  if (!node.toAgent?.id || !node.toAgent.versionId) return `步骤「${node.title}」还没有选择已发布的接收助手`;
  if (currentAgentId && node.toAgent.id === currentAgentId) return `步骤「${node.title}」不能交接给当前助手自身`;
  const contract = node.contract;
  if (!contract?.deliverables.length) return `步骤「${node.title}」还没有填写必须交付的内容`;
  if (!contract.mustNotInclude.length) return `步骤「${node.title}」还没有填写禁止传递的内容`;
  if (!contract.inputSchema.length || !contract.outputSchema.length || !contract.memoryPolicy) {
    return `步骤「${node.title}」的交接契约不完整，请重新选择接收助手`;
  }
  return null;
}

function readHandoffPath(value: Record<string, unknown>, path: string): unknown {
  const segments = safeDataPathSegments(path);
  if (!segments) return undefined;
  return segments.reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function handoffTypeMatches(value: unknown, type: string): boolean {
  if (type === "any") return true;
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return !!value && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  return false;
}

export function validateHandoffOutput(node: WorkflowNode, result: Record<string, unknown>): string | null {
  for (const field of node.contract?.outputSchema ?? []) {
    const value = readHandoffPath(result, field.name);
    if (value === undefined || value === null) {
      if (field.required) return `交接结果缺少“${field.label || field.name}”`;
      continue;
    }
    if (!handoffTypeMatches(value, field.type)) {
      return `交接结果“${field.label || field.name}”的格式不正确`;
    }
  }
  return null;
}
