import { isPassiveJsonData } from "@/contracts/json";
import { MAX_WORKFLOW_BYTES, QualityGateSpec, WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { validateInputMappingReferences } from "@/server/domain/runtime/input-mapping";
import { validateWorkflowModelOutputConfigurations } from "@/server/domain/runtime/model-output";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";
import { qualityGateRulesState, validateQualityGateRulesRemoval } from "./quality-gate-rules-editing";
import { qualityOutputReferenceIssue } from "@/server/domain/runtime/quality-checks";
import { validateAiReworkReset } from "./ai-rework-editing";

export type NodeContractField = "inputMapping" | "modelOutput" | "toolOperation" | "retry" | "quality";
export type InlineContractLocation = { stepIndex: number; branchId?: string };
type EditResult = { ok: true; node: WorkflowNode } | { ok: false; error: string };
type InlineResult = { ok: true; node: WorkflowNode; raw: Record<string, unknown> } | { ok: false; error: string };

const unavailable = "当前组内步骤配置无法完整核对，原设置保持不变。请先检查步骤组或并行工作。";
function same(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function unchangedDetails(previous: WorkflowNode, next: WorkflowNode) {
  const left = { ...previous }, right = { ...next };
  delete left.inputMapping; delete left.modelOutput; delete left.toolOperation; delete left.retry; delete left.quality;
  delete right.inputMapping; delete right.modelOutput; delete right.toolOperation; delete right.retry; delete right.quality;
  return same(left, right);
}

export function readInlineContractNode(parent: WorkflowNode, location: InlineContractLocation): InlineResult {
  if (!Number.isInteger(location.stepIndex) || location.stepIndex < 0
    || !isPassiveJsonData(parent, MAX_WORKFLOW_BYTES) || !WorkflowNode.safeParse(parent).success) {
    return { ok: false, error: unavailable };
  }
  let node: WorkflowNode | undefined, raw: Record<string, unknown> | undefined;
  if (parent.type === "subflow" && location.branchId === undefined) {
    const prepared = prepareSubflow(parent);
    if (prepared.ok) { node = prepared.steps[location.stepIndex]; raw = parent.subflow?.steps[location.stepIndex]; }
  } else if (parent.type === "parallel" && location.branchId !== undefined) {
    const prepared = prepareParallelBranches(parent);
    if (prepared.ok) {
      node = prepared.branches.find((branch) => branch.id === location.branchId)?.steps[location.stepIndex];
      raw = parent.parallel?.branches.find((branch) => branch.id === location.branchId)?.steps[location.stepIndex];
    }
  }
  if (!node || !raw) return { ok: false, error: unavailable };
  // 旧规则的未知字段须由编辑器只读核对，不能先被契约解析剥离。
  if (Object.hasOwn(raw, "modelOutput")) node = { ...node, modelOutput: raw.modelOutput as WorkflowNode["modelOutput"] };
  if (Object.hasOwn(raw, "toolOperation")) node = { ...node, toolOperation: raw.toolOperation as WorkflowNode["toolOperation"] };
  return { ok: true, node, raw };
}

function validateParentDraft(workflow: WorkflowDraft, previous: WorkflowNode, next: WorkflowNode): EditResult {
  if (!isPassiveJsonData(workflow, MAX_WORKFLOW_BYTES) || !isPassiveJsonData(previous, MAX_WORKFLOW_BYTES)) {
    return { ok: false, error: "完整流程草稿无法安全核对或超过容量，原草稿保持不变。" };
  }
  if (!Object.hasOwn(workflow.nodes, previous.id) || !same(workflow.nodes[previous.id], previous)) {
    return { ok: false, error: "画布中的步骤已经变化或无法定位，原草稿保持不变。请重新核对当前步骤。" };
  }
  const candidate = { ...workflow, nodes: { ...workflow.nodes, [previous.id]: next } };
  if (!isPassiveJsonData(candidate, MAX_WORKFLOW_BYTES) || !WorkflowDraft.safeParse(candidate).success) {
    return { ok: false, error: "应用后完整流程草稿未通过格式或容量校验，原草稿保持不变。请减少内容或先核对流程定义。" };
  }
  if (validateInputMappingReferences(candidate)) {
    return { ok: false, error: "流程中有输入来源或操作防重来源无法核对，原草稿保持不变。请先检查相关步骤。" };
  }
  if (validateWorkflowModelOutputConfigurations(candidate)) {
    return { ok: false, error: "流程中的结果字段约定未通过现有校验，原草稿保持不变。请检查规则与原模拟样例。" };
  }
  return { ok: true, node: next };
}

function contractUpdate(raw: Record<string, unknown>, next: WorkflowNode, field: NodeContractField) {
  const result = { ...raw };
  if (next[field] === undefined) delete result[field];
  else result[field] = next[field];
  return result;
}

export function applyTopLevelNodeContract(workflow: WorkflowDraft, node: WorkflowNode, next: WorkflowNode, field: NodeContractField): EditResult {
  if (field === "retry" && node.type !== "ai") return { ok: false, error: "自动返工设置只适用于顶层智能处理步骤，原设置保持不变。" };
  if (!isPassiveJsonData(node, MAX_WORKFLOW_BYTES) || !isPassiveJsonData(next, MAX_WORKFLOW_BYTES) || !unchangedDetails(node, next) || !WorkflowNode.safeParse(next).success) {
    return { ok: false, error: "这次修改不只涉及字段约定或未通过步骤校验，原草稿保持不变。" };
  }
  if (field === "retry" && next.retry === undefined) {
    const reset = validateAiReworkReset(workflow, node.id);
    if (!reset.ok) return reset;
  }
  if (field === "quality") {
    const state = qualityGateRulesState(workflow, node.id, true);
    if (!state.editable) return { ok: false, error: state.issue ?? "当前步骤不能应用交付质量规则，原设置保持不变。" };
    if (next.quality === undefined) {
      const removal = validateQualityGateRulesRemoval(workflow, node.id, true);
      if (!removal.ok) return removal;
    } else {
      const quality = QualityGateSpec.safeParse(next.quality);
      if (!quality.success || qualityOutputReferenceIssue(workflow.nodes, quality.data.requiredOutputTitles, quality.data.minOutputCount)) {
        return { ok: false, error: "质量规则中的来源或最低数量无法核对，原草稿保持不变。" };
      }
    }
  }
  const updated = { ...node };
  if (next[field] === undefined) delete updated[field];
  else Object.assign(updated, { [field]: next[field] });
  return validateParentDraft(workflow, node, updated);
}

export function applyInlineNodeContract(workflow: WorkflowDraft, parent: WorkflowNode, location: InlineContractLocation, expected: WorkflowNode, next: WorkflowNode, field: NodeContractField): EditResult {
  if (field === "retry") return { ok: false, error: "当前质量检查不会自动返工组内步骤，不能在此应用声称生效的返工设置。" };
  if (field === "quality") return { ok: false, error: "组内步骤不执行顶层交付质量规则，不能在此应用声称生效的设置。" };
  const current = readInlineContractNode(parent, location);
  if (!current.ok) return current;
  if (!isPassiveJsonData(expected, MAX_WORKFLOW_BYTES) || !same(current.node, expected) || !isPassiveJsonData(next, MAX_WORKFLOW_BYTES)
    || !unchangedDetails(current.node, next) || !WorkflowNode.safeParse(next).success) {
    return { ok: false, error: "组内步骤已变化或这次修改超出字段约定，原草稿保持不变。请重新核对。" };
  }
  const raw = contractUpdate(current.raw, next, field);
  let updated: WorkflowNode;
  if (parent.type === "subflow" && parent.subflow && location.branchId === undefined) {
    updated = { ...parent, subflow: { ...parent.subflow, steps: parent.subflow.steps.map((step, index) => index === location.stepIndex ? raw : step) } };
  } else if (parent.type === "parallel" && parent.parallel) {
    updated = { ...parent, parallel: { ...parent.parallel, branches: parent.parallel.branches.map((branch) => branch.id === location.branchId
      ? { ...branch, steps: branch.steps.map((step, index) => index === location.stepIndex ? raw : step) } : branch) } };
  } else return { ok: false, error: unavailable };
  const prepared = readInlineContractNode(updated, location);
  if (!prepared.ok) return prepared;
  return validateParentDraft(workflow, parent, updated);
}
