import { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import { buildBoundedCollaborationContext, collaborationDataWithMemoryPolicy } from "@/server/domain/runtime/collaboration-input";
import { resolveNodeInput } from "./input-mapping";
import { safeDataPathSegments } from "@/server/domain/runtime/data-path";
import { hasMeaningfulResult } from "@/server/domain/runtime/result-content";
import { redactSensitiveData } from "@/server/domain/security/redact-sensitive";

function ownValue(source: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

export function buildAgentCallInput(args: {
  node: WorkflowNode;
  targetManifest: AgentManifest;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
}): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  const fields = args.targetManifest.inputContract.fields;
  const input = redactSensitiveData(args.input) as Record<string, unknown>;
  const team = args.node.agentCall?.memoryAccess?.mode === "team";
  const accessibleOutputs = collaborationDataWithMemoryPolicy(args.outputs, team);
  const outputs = redactSensitiveData(accessibleOutputs) as Record<string, unknown>;
  if (args.node.inputMapping) {
    if (args.node.inputMapping.includeUpstreamOutputs) return { ok: false, error: "助手协作请逐项映射需要的上游字段，不能额外携带全部成果" };
    const mapped = resolveNodeInput({ node: args.node, input, outputs });
    if (!mapped.ok) return mapped;
    const mappedInput = collaborationDataWithMemoryPolicy(mapped.input, team);
    return { ok: true, input: redactSensitiveData(mappedInput) as Record<string, unknown> };
  }
  const fallbackCopies = fields.filter((field) => {
    const value = ownValue(input, field.name) ?? ownValue(outputs, field.name);
    return (value === undefined || value === null) && field.type === "string";
  }).length;
  const context = buildBoundedCollaborationContext({
    task: input,
    previousResults: Object.values(outputs),
    request: args.node.description || args.node.title,
  }, fallbackCopies || 1);
  if (fields.length === 0) return { ok: true, input: { context } };
  return { ok: true, input: Object.fromEntries(fields.flatMap((field) => {
    const value = ownValue(input, field.name) ?? ownValue(outputs, field.name);
    if (value !== undefined && value !== null) return [[field.name, value]];
    return field.type === "string" ? [[field.name, context]] : [];
  })) };
}

export function validateAgentCallNode(node: WorkflowNode, currentAgentId?: string): string | null {
  const call = node.agentCall;
  if (!call?.targetAgentId || !call.versionId) return `步骤「${node.title}」还没有选择已发布的协作助手`;
  if (currentAgentId && call.targetAgentId === currentAgentId) return `步骤「${node.title}」不能调用当前助手自身`;
  return null;
}

function readOutputPath(result: Record<string, unknown>, path: string): unknown {
  const segments = safeDataPathSegments(path);
  if (!segments) return undefined;
  return segments.reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, result);
}

export function validateAgentCallOutput(node: WorkflowNode, result: Record<string, unknown>): string | null {
  const parsed = AgentManifest.shape.outputContract.safeParse(node.agentCall?.outputContract);
  if (!parsed.success) return `步骤「${node.title}」冻结的协作结果契约不完整`;
  for (const field of parsed.data?.fields ?? []) {
    if (!field.required) continue;
    if (!hasMeaningfulResult(readOutputPath(result, field.path))) {
      return `协作结果缺少“${field.label || field.path}”`;
    }
  }
  return null;
}
