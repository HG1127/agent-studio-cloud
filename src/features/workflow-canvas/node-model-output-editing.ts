import { isPassiveJsonData } from "@/contracts/json";
import { MAX_MODEL_MOCK_OUTPUT_BYTES, MAX_MODEL_OUTPUT_SCHEMA_BYTES, ModelOutputConfig } from "@/contracts/model-output";
import { MAX_WORKFLOW_BYTES, WorkflowNode } from "@/contracts/workflow";
import { validateModelOutputConfiguration } from "@/server/domain/runtime/model-output";

export type ModelOutputEditorDraft = Pick<ModelOutputConfig, "providerMode" | "maxRepairAttempts"> & { schemaText: string };
type EditResult = { ok: true; node: WorkflowNode } | { ok: false; error: string };

export function modelOutputNodeSnapshot(node: WorkflowNode): string | null {
  if (!isPassiveJsonData(node, MAX_WORKFLOW_BYTES)) return null;
  return JSON.stringify(node);
}

export function inspectNodeModelOutput(node: WorkflowNode): { editable: boolean; configured: boolean; config: ModelOutputConfig | null; issue: string | null } {
  const configured = node.modelOutput !== undefined;
  const probe = WorkflowNode.safeParse({ ...node, modelOutput: { format: "json", schema: { type: "object" } } });
  if (!probe.success || modelOutputNodeSnapshot(node) === null) {
    return { editable: false, configured, config: null, issue: "当前步骤类型或原配置不支持编辑模型结果约定，原信息已保留。" };
  }
  if (!configured) return { editable: true, configured: false, config: null, issue: null };
  const raw = node.modelOutput;
  if (!isPassiveJsonData(raw, MAX_MODEL_OUTPUT_SCHEMA_BYTES + MAX_MODEL_MOCK_OUTPUT_BYTES + 4096)
    || !raw || typeof raw !== "object" || Array.isArray(raw)
    || Object.keys(raw).some((key) => !Object.hasOwn(ModelOutputConfig.shape, key))) {
    return { editable: false, configured: true, config: null, issue: "旧约定包含未知或无法安全读取的信息，已原样保留；请先核对旧配置。" };
  }
  const config = ModelOutputConfig.safeParse(raw);
  if (!config.success || validateModelOutputConfiguration({ title: node.title, modelOutput: config.data }) !== null) {
    return { editable: false, configured: true, config: null, issue: "旧约定或原模拟样例无法通过现有校验，已原样保留；请先核对旧配置。" };
  }
  return { editable: true, configured: true, config: config.data, issue: null };
}

export function createModelOutputEditorDraft(node: WorkflowNode): ModelOutputEditorDraft | null {
  const state = inspectNodeModelOutput(node);
  if (!state.editable) return null;
  return {
    schemaText: JSON.stringify(state.config?.schema ?? { type: "object", properties: {} }, null, 2),
    providerMode: state.config?.providerMode ?? "json",
    maxRepairAttempts: state.config?.maxRepairAttempts ?? 1,
  };
}

export function applyNodeModelOutputDraft(node: WorkflowNode, draft: ModelOutputEditorDraft, snapshot: string): EditResult {
  if (modelOutputNodeSnapshot(node) !== snapshot) return { ok: false, error: "步骤已发生变化，请取消编辑并重新打开，原信息没有覆盖。" };
  if (!inspectNodeModelOutput(node).editable) return { ok: false, error: "当前旧配置只能查看，不能替换。" };
  let schema: unknown;
  try { schema = JSON.parse(draft.schemaText); } catch { return { ok: false, error: "字段规则的对象格式不正确，请在开发者编辑区核对。" }; }
  const candidate = { ...node.modelOutput, format: "json" as const, schema, providerMode: draft.providerMode, maxRepairAttempts: draft.maxRepairAttempts };
  const config = ModelOutputConfig.safeParse(candidate);
  if (!config.success) return { ok: false, error: "字段规则必须是对象且不超过32KB；请求方式、修正次数和原模拟样例也必须符合约定。" };
  const configurationIssue = validateModelOutputConfiguration({ title: node.title, modelOutput: config.data });
  if (configurationIssue) return { ok: false, error: configurationIssue.replaceAll("模型结果字段契约", "结果字段约定") };
  const next = { ...node, modelOutput: { ...node.modelOutput, ...config.data } };
  if (!WorkflowNode.safeParse(next).success) return { ok: false, error: "整个步骤未通过现有校验，原草稿没有修改。" };
  return { ok: true, node: next };
}

export function clearNodeModelOutput(node: WorkflowNode, snapshot: string): EditResult {
  if (modelOutputNodeSnapshot(node) !== snapshot) return { ok: false, error: "步骤已发生变化，请重新核对，原信息没有清除。" };
  if (!inspectNodeModelOutput(node).editable) return { ok: false, error: "当前旧配置只能查看，不能清除。" };
  const next = { ...node };
  delete next.modelOutput;
  if (!WorkflowNode.safeParse(next).success) return { ok: false, error: "整个步骤未通过现有校验，原草稿没有修改。" };
  return { ok: true, node: next };
}
