import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { validateOutputContract, validateOutputFieldPaths, workflowOutputSourceNodes } from "@/server/domain/runtime/output-contract";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";

export type OutputField = NonNullable<WorkflowDraft["outputContract"]>["fields"][number];

export function outputSourceOptions(nodes: Record<string, WorkflowNode>) {
  const context = new Map(Object.values(nodes).map((node) => [node.id, { ownerId: node.id, label: node.title }]));
  for (const node of Object.values(nodes)) {
    if (isHiddenControlNode(node)) continue;
    if (node.type === "subflow") {
      const prepared = prepareSubflow(node);
      if (prepared.ok) for (const step of prepared.steps) context.set(step.id, { ownerId: node.id, label: `${node.title} / ${step.title}` });
    } else if (node.type === "parallel") {
      const prepared = prepareParallelBranches(node);
      if (prepared.ok) for (const branch of prepared.branches) for (const step of branch.steps) {
        context.set(step.id, { ownerId: node.id, label: `${node.title} / ${branch.label} / ${step.title}` });
      }
    }
  }
  return Object.values(workflowOutputSourceNodes(nodes))
    .filter((node) => node.type !== "trigger" && node.type !== "end" && !isHiddenControlNode(node))
    .map((node) => ({ node, ...context.get(node.id)! }));
}

export function outputSourceCandidates(nodes: Record<string, WorkflowNode>) {
  return outputSourceOptions(nodes).map((option) => option.node);
}

export function outputSourceOwnerId(sourceId: string, nodes: Record<string, WorkflowNode>): string | null {
  return outputSourceOptions(nodes).find((option) => option.node.id === sourceId)?.ownerId ?? null;
}

export function sameOutputSelection(first: OutputField, second: OutputField): boolean {
  return !!first.sourceNodeId && first.sourceNodeId === second.sourceNodeId
    && JSON.stringify(first.sourcePath ?? []) === JSON.stringify(second.sourcePath ?? []);
}

export function outputDefinitionIssue(field: OutputField, fields: OutputField[], nodes: Record<string, WorkflowNode>): string | null {
  if (!field.sourceNodeId) return "请明确选择交付来源；保留原定义，不按字段位置猜测来源步骤。";
  const issue = validateOutputContract([field], nodes);
  if (issue) return issue;
  for (const other of fields) {
    if (other === field) continue;
    const conflict = validateOutputFieldPaths([other, field]);
    if (conflict && !validateOutputFieldPaths([other])) return conflict;
  }
  return null;
}

export function newOutputDefinition(fields: OutputField[], nodes: Record<string, WorkflowNode>): OutputField | null {
  const candidates = outputSourceCandidates(nodes);
  const source = candidates.find((node) => !fields.some((field) => field.sourceNodeId === node.id)) ?? candidates[0];
  if (!source) return null;
  for (let index = 1; index <= fields.length + 1; index += 1) {
    const path = "交付内容_" + index;
    const field = { path, label: source.title, required: true, sourceNodeId: source.id };
    if (!validateOutputFieldPaths([...fields, field])) return field;
  }
  return null;
}

export function moveOutputDefinition(fields: OutputField[], index: number, delta: -1 | 1): OutputField[] {
  const target = index + delta;
  if (!Number.isInteger(index) || index < 0 || index >= fields.length || target < 0 || target >= fields.length) return fields;
  const next = [...fields];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
