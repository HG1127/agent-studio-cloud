import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import { buildBoundedCollaborationContext, isCollaborationMemoryOutput } from "@/server/domain/runtime/collaboration-input";
import { redactSensitiveData } from "@/server/domain/security/redact-sensitive";

function ownValue(source: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

export function buildAgentCallInput(args: {
  node: WorkflowNode;
  targetManifest: AgentManifest;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
}): Record<string, unknown> {
  const fields = args.targetManifest.inputContract.fields;
  const input = redactSensitiveData(args.input) as Record<string, unknown>;
  const accessibleOutputs = args.node.agentCall?.memoryAccess?.mode === "team"
    ? args.outputs
    : Object.fromEntries(Object.entries(args.outputs).filter(([, value]) => !isCollaborationMemoryOutput(value)));
  const outputs = redactSensitiveData(accessibleOutputs) as Record<string, unknown>;
  const fallbackCopies = fields.filter((field) => {
    const value = ownValue(input, field.name) ?? ownValue(outputs, field.name);
    return (value === undefined || value === null) && field.type === "string";
  }).length;
  const context = buildBoundedCollaborationContext({
    task: input,
    previousResults: Object.values(outputs),
    request: args.node.description || args.node.title,
  }, fallbackCopies || 1);
  if (fields.length === 0) return { context };
  return Object.fromEntries(fields.flatMap((field) => {
    const value = ownValue(input, field.name) ?? ownValue(outputs, field.name);
    if (value !== undefined && value !== null) return [[field.name, value]];
    return field.type === "string" ? [[field.name, context]] : [];
  }));
}

export function validateAgentCallNode(node: WorkflowNode, currentAgentId?: string): string | null {
  const call = node.agentCall;
  if (!call?.targetAgentId || !call.versionId) return `步骤「${node.title}」还没有选择已发布的协作助手`;
  if (currentAgentId && call.targetAgentId === currentAgentId) return `步骤「${node.title}」不能调用当前助手自身`;
  return null;
}
