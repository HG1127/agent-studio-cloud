import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";

export function buildAgentCallInput(args: {
  node: WorkflowNode;
  targetManifest: AgentManifest;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
}): Record<string, unknown> {
  const context = JSON.stringify({
    task: args.input,
    previousResults: Object.values(args.outputs),
    request: args.node.description || args.node.title,
  });
  return Object.fromEntries(args.targetManifest.inputContract.fields.map((field) => [
    field.name,
    args.input[field.name] ?? args.outputs[field.name] ?? context,
  ]));
}

export function validateAgentCallNode(node: WorkflowNode, currentAgentId?: string): string | null {
  const call = node.agentCall;
  if (!call?.targetAgentId || !call.versionId) return `步骤「${node.title}」还没有选择已发布的协作助手`;
  if (currentAgentId && call.targetAgentId === currentAgentId) return `步骤「${node.title}」不能调用当前助手自身`;
  return null;
}
