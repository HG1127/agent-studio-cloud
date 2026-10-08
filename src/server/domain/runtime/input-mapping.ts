import { InputMapping, type InputValueSource } from "@/contracts/input-mapping";
import { RunInputPayload } from "@/contracts/run";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { prepareParallelBranches } from "./parallel-runtime";
import { prepareSubflow } from "./subflow-runtime";

function readOwnPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function resolveInputValue(source: InputValueSource, input: Record<string, unknown>, outputs: Record<string, unknown>): unknown {
  return source.kind === "literal" ? source.value
    : source.kind === "input" ? readOwnPath(input, source.path)
    : readOwnPath(Object.hasOwn(outputs, source.nodeId) ? outputs[source.nodeId] : undefined, source.path);
}

export function resolveNodeInput(args: {
  node: Pick<WorkflowNode, "title" | "inputMapping">;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
}):
  | { ok: true; input: Record<string, unknown>; outputs: Record<string, unknown> }
  | { ok: false; error: string } {
  if (!args.node.inputMapping) return { ok: true, input: args.input, outputs: args.outputs };
  const parsed = InputMapping.safeParse(args.node.inputMapping);
  if (!parsed.success) return { ok: false, error: `步骤「${args.node.title}」的字段映射配置无效` };
  const input: Record<string, unknown> = {};
  for (const binding of parsed.data.fields) {
    const source = binding.source;
    let value = resolveInputValue(source, args.input, args.outputs);
    if (value === undefined) value = binding.fallback;
    if (value === undefined) {
      if (binding.required) return { ok: false, error: `步骤「${args.node.title}」缺少映射字段“${binding.target.join(".")}”的来源数据` };
      continue;
    }
    const sourceValue = RunInputPayload.safeParse({ value });
    if (!sourceValue.success) return { ok: false, error: `步骤「${args.node.title}」的映射来源不能保存或超过运行输入限制` };
    let object = input;
    for (const segment of binding.target.slice(0, -1)) {
      if (!Object.hasOwn(object, segment)) object[segment] = {};
      object = object[segment] as Record<string, unknown>;
    }
    object[binding.target.at(-1)!] = JSON.parse(JSON.stringify(sourceValue.data.value));
  }
  const validated = RunInputPayload.safeParse(input);
  if (!validated.success) return { ok: false, error: `步骤「${args.node.title}」映射后的输入不能保存或超过运行输入限制` };
  // 复制只包含已校验的 JSON，映射结果不能修改原始运行输入或其他分支产出。
  return {
    ok: true, input: JSON.parse(JSON.stringify(validated.data)),
    outputs: parsed.data.includeUpstreamOutputs ? args.outputs : {},
  };
}

export function validateInputMappingReferences(draft: Pick<WorkflowDraft, "nodes">): string | null {
  const nodes = Object.values(draft.nodes);
  const allNodes = [...nodes];
  for (const node of nodes) {
    if (node.type === "parallel") {
      const prepared = prepareParallelBranches(node);
      if (prepared.ok) allNodes.push(...prepared.branches.flatMap((branch) => branch.steps));
    } else if (node.type === "subflow") {
      const prepared = prepareSubflow(node);
      if (prepared.ok) allNodes.push(...prepared.steps);
    }
  }
  const availableIds = new Set(allNodes.map((node) => node.id));
  for (const node of allNodes) {
    const operationKey = node.toolOperation?.key;
    if (operationKey?.kind === "output" && !availableIds.has(operationKey.nodeId)) {
      return `步骤「${node.title}」的操作防重标识引用了不存在的来源步骤`;
    }
    for (const binding of node.inputMapping?.fields ?? []) {
      if (binding.source.kind === "output" && !availableIds.has(binding.source.nodeId)) {
        return `步骤「${node.title}」的字段映射引用了不存在的来源步骤`;
      }
    }
  }
  return null;
}
