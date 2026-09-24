import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";

const SECRET_KEY = /password|passcode|secret|token|api[_-]?key|credential|cookie|authorization|private[_-]?key|密码|密钥|令牌|凭证|授权|私钥/i;

function normalizedTerms(node: WorkflowNode): string[] {
  return (node.contract?.mustNotInclude ?? [])
    .map((term) => term.toLowerCase().replace(/[\s_-]/g, ""))
    .filter((term) => term.length >= 2);
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
  const context = JSON.stringify({
    task: sourceInput,
    previousResults: Object.values(sourceOutputs),
    handoff: {
      request: args.node.description || args.node.title,
      deliverables: args.node.contract?.deliverables ?? [],
      mustNotInclude: args.node.contract?.mustNotInclude ?? [],
    },
  });
  const fields = args.targetManifest.inputContract.fields;
  const input = fields.length === 0 ? { brief: context } : Object.fromEntries(fields.map((field) => [
    field.name,
    sourceInput[field.name] ?? sourceOutputs[field.name] ?? context,
  ]));
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
