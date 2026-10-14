import { InlineOutputReference, type InlineOutputReferences } from "@/contracts/inline-output-reference";
import type { WorkflowDraft, WorkflowNode, WorkflowOutputField } from "@/contracts/workflow";
import { prepareParallelBranches } from "./parallel-runtime";
import { prepareSubflow } from "./subflow-runtime";

export function buildInlineOutputCatalog(draft: Pick<WorkflowDraft, "nodes">): InlineOutputReferences {
  const catalog: InlineOutputReferences = {};
  for (const node of Object.values(draft.nodes)) {
    if (node.type === "subflow") {
      const prepared = prepareSubflow(node);
      if (prepared.ok) prepared.steps.forEach((step, stepIndex) => {
        if (step.id.length <= 200) catalog[step.id] = { kind: "subflow", ownerNodeId: node.id, stepIndex };
      });
    } else if (node.type === "parallel") {
      const prepared = prepareParallelBranches(node);
      if (prepared.ok) for (const branch of prepared.branches) for (const step of branch.steps) {
        if (step.id.length <= 200) catalog[step.id] = { kind: "parallel", ownerNodeId: node.id, branchId: branch.id };
      }
    }
  }
  return catalog;
}

export function selectInlineOutputReferences(catalog: InlineOutputReferences, node: Pick<WorkflowNode, "inputMapping" | "toolOperation">, activeOwnerNodeId?: string): InlineOutputReferences {
  const sources = (node.inputMapping?.fields ?? []).map((field) => field.source);
  if (node.toolOperation) sources.push(node.toolOperation.key);
  const selected: InlineOutputReferences = {};
  for (const source of sources) {
    if (source.kind !== "output" || !Object.hasOwn(catalog, source.nodeId)) continue;
    const reference = catalog[source.nodeId];
    // 当前容器只能读取本次已执行的平铺成果，不能借用上次汇总或未完成的兄弟分支。
    if (reference.ownerNodeId !== activeOwnerNodeId) selected[source.nodeId] = reference;
  }
  return selected;
}

export function selectWorkflowOutputReferences(catalog: InlineOutputReferences, fields: WorkflowOutputField[]): InlineOutputReferences {
  const selected: InlineOutputReferences = {};
  for (const field of fields) {
    if (field.sourceNodeId && Object.hasOwn(catalog, field.sourceNodeId)) selected[field.sourceNodeId] = catalog[field.sourceNodeId];
  }
  return selected;
}

function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function readInlineOutput(nodeId: string, outputs: Record<string, unknown>, references?: InlineOutputReferences): unknown {
  if (!references || !Object.hasOwn(references, nodeId)) return undefined;
  const parsed = InlineOutputReference.safeParse(references[nodeId]);
  if (!parsed.success) return undefined;
  const reference = parsed.data;
  const owner = own(outputs, reference.ownerNodeId);
  const status = own(owner, "status");
  if (reference.kind === "subflow") {
    if (status !== "completed") return undefined;
    const steps = own(owner, "steps");
    return Array.isArray(steps) ? own(own(steps, String(reference.stepIndex)), "output") : undefined;
  }
  if (status !== "completed" && status !== "completed_with_issues") return undefined;
  const branch = own(own(owner, "branches"), reference.branchId);
  if (own(branch, "status") !== "completed") return undefined;
  return own(own(branch, "outputs"), nodeId);
}
