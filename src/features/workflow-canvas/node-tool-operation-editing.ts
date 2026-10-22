import { InputSourcePath, InputValueSource } from "@/contracts/input-mapping";
import { boundedJsonStorageValue, isPassiveJsonData } from "@/contracts/json";
import { ToolOperationConfig } from "@/contracts/tool-operation";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { MAX_WORKFLOW_BYTES, WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { canonicalJson } from "@/server/domain/canonical-json";
import { validateJsonSchemaDefinition } from "@/server/domain/json-schema";
import { validateInputMappingReferences } from "@/server/domain/runtime/input-mapping";
import { validateInlineWorkflows } from "@/server/domain/runtime/inline-workflow";
import { validateOutputContract, workflowOutputSourceNodes } from "@/server/domain/runtime/output-contract";
import { validateWaitContracts } from "@/server/domain/runtime/wait-contract";
import { validateWorkflowRoutes } from "@/server/domain/runtime/workflow-routes";
import { toolBindingChanges } from "./tool-binding-status";
import { applyInlineNodeContract, applyTopLevelNodeContract, readInlineContractNode, type InlineContractLocation } from "./node-contract-editing";

export type ToolOperationEditorContext = { node: WorkflowNode; workflow: WorkflowDraft; tools: readonly ToolRegistryOption[]; inline?: { parent: WorkflowNode; location: InlineContractLocation } };
export type ToolOperationEditorDraft = { scope: string; kind: "" | InputValueSource["kind"]; nodeId: string; path: string[]; literalType: "string" | "number"; literalText: string };
const StoredWorkflow = boundedJsonStorageValue(MAX_WORKFLOW_BYTES, "流程草稿");
const MAX_CONTEXT_BYTES = MAX_WORKFLOW_BYTES * 4;

function passiveSnapshot(value: unknown, capacity: number): string | null {
  try {
    if (!isPassiveJsonData(value, capacity)) return null;
    const text = JSON.stringify(value);
    return new TextEncoder().encode(text).byteLength <= capacity ? text : null;
  } catch { return null; }
}

export function toolOperationContextSnapshot(context: ToolOperationEditorContext): string | null {
  return passiveSnapshot(context, MAX_CONTEXT_BYTES);
}

function workflowIssue(workflow: WorkflowDraft): boolean {
  const parsed = WorkflowDraft.safeParse(workflow);
  if (!parsed.success) return true;
  const draft = parsed.data;
  return Boolean(validateWorkflowRoutes(draft) || validateWaitContracts(draft.nodes) || validateInlineWorkflows(draft) || validateOutputContract(draft.outputContract?.fields ?? [], draft.nodes));
}

export function inspectNodeToolOperation(context: ToolOperationEditorContext) {
  const snapshot = toolOperationContextSnapshot(context);
  const descriptor = context.node && typeof context.node === "object" ? Object.getOwnPropertyDescriptor(context.node, "toolOperation") : undefined;
  const configured = descriptor !== undefined;
  const rawText = passiveSnapshot(descriptor?.value, MAX_WORKFLOW_BYTES);
  const base = { snapshot, configured, rawText, config: null as ToolOperationConfig | null, registration: null as ToolRegistryOption | null };
  const fail = (issue: string) => ({ ...base, editable: false, issue });
  if (snapshot === null) return fail("原信息不能安全读取或超过容量，已保留原内容，暂不能编辑。");
  const { node, workflow, tools } = context;
  const parsedNode = WorkflowNode.safeParse(node);
  if (!StoredWorkflow.safeParse(workflow).success || !WorkflowDraft.safeParse(workflow).success || !parsedNode.success) return fail("步骤或完整流程配置无效，已保留原内容，暂不能编辑。");
  if (context.inline) {
    const { parent, location } = context.inline;
    const current = readInlineContractNode(parent, location);
    if (!Object.hasOwn(workflow.nodes, parent.id) || canonicalJson(workflow.nodes[parent.id]) !== canonicalJson(parent)
      || !current.ok || canonicalJson(current.node) !== canonicalJson(node)) return fail("所属步骤组、并行工作或当前步骤已变化，请从当前画布重新打开。");
  } else if (!Object.hasOwn(workflow.nodes, node.id) || canonicalJson(workflow.nodes[node.id]) !== canonicalJson(node)) return fail("当前步骤与完整流程不一致，请从当前画布重新打开。");
  if (node.type !== "tool" || node.tool?.protocol === "demo") return fail("只有真实业务工具步骤可以设置操作防重。");
  const config = configured ? ToolOperationConfig.safeParse(node.toolOperation) : null;
  if (config && !config.success) return fail("原防重规则含未识别或无效内容，已原样保留，暂不能替换或清除。");
  base.config = config?.success ? config.data : null;
  if (!node.tool || node.tool.unresolved || !node.tool.registryToolId) return fail("尚未绑定可用业务工具，请先核对工具登记。");
  const parsedTools = ToolRegistryOption.array().max(1000).safeParse(tools);
  if (!parsedTools.success || tools.some((tool) => ["id", "name", "action", "scope", "risk", "inputSchema", "outputSchema"].some((field) => !Object.hasOwn(tool, field)))) return fail("工具登记信息不完整，不能确认防重支持情况。");
  const matches = parsedTools.data.filter((tool) => tool.id === node.tool!.registryToolId);
  if (matches.length !== 1) return fail("当前工具登记缺失或重复，不能确认防重支持情况。");
  const registration = matches[0];
  base.registration = registration;
  if (registration.protocol === "mcp-streamable-http" && !registration.operationKind || validateJsonSchemaDefinition(registration.inputSchema) || validateJsonSchemaDefinition(registration.outputSchema)) return fail("工具登记的传输或字段约定不完整，原规则仍已保留。");
  if (registration.businessIdempotency === false) return fail("当前工具登记明确不支持业务操作防重，原规则仍已保留。");
  if (registration.businessIdempotency !== true || !registration.businessIdempotencyRetentionMs) return fail("当前工具尚未明确登记防重能力及有效期，原规则仍已保留。");
  const consumedTool = parsedNode.data.tool!;
  if (toolBindingChanges(consumedTool, registration).length || consumedTool.protocol !== (registration.protocol ?? "http-json") || registration.protocol === "mcp-streamable-http" && consumedTool.operationKind !== registration.operationKind) return fail("当前工具与步骤保存的约定不同，请先核对绑定，原规则仍已保留。");
  const referenceIssue = validateInputMappingReferences(workflow);
  if (referenceIssue) return fail("完整流程存在失效的字段来源，请先核对，原规则仍已保留。");
  if (workflowIssue(workflow)) return fail("完整流程的路径、等待、组内步骤或成果约定尚未通过校验，原规则仍已保留。");
  if (base.config?.key.kind === "literal" && !validOperationLiteral(base.config.key.value)) return fail("原固定标识不是有效的短文字或安全整数，原规则仍已保留。");
  return { ...base, editable: true, issue: null };
}

function validOperationLiteral(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256 || typeof value === "number" && Number.isSafeInteger(value);
}

export function createToolOperationEditorDraft(context: ToolOperationEditorContext): ToolOperationEditorDraft | null {
  const state = inspectNodeToolOperation(context);
  if (!state.editable) return null;
  const key = state.config?.key;
  return { scope: state.config?.scope ?? "", kind: key?.kind ?? "", nodeId: key?.kind === "output" ? key.nodeId : "", path: key && key.kind !== "literal" ? [...key.path] : [], literalType: key?.kind === "literal" && typeof key.value === "number" ? "number" : "string", literalText: key?.kind === "literal" ? String(key.value) : "" };
}

export function toolOperationSources(context: ToolOperationEditorContext) {
  if (!inspectNodeToolOperation(context).editable) return { inputs: [], outputs: [] };
  const workflow = WorkflowDraft.parse(context.workflow);
  const all = Object.values(workflowOutputSourceNodes(workflow.nodes));
  return {
    inputs: workflow.variables.filter((variable) => variable.scope === "run"),
    outputs: all.filter((node) => node.id !== context.node.id && node.type !== "trigger" && node.type !== "end" && !node.controlPlane?.hiddenByDefault && node.ui?.visibility !== "control"),
  };
}

export function toolOperationOutputFields(node: WorkflowNode | undefined): { path: string[]; label: string }[] {
  if (!node || passiveSnapshot(node, MAX_WORKFLOW_BYTES) === null || !WorkflowNode.safeParse(node).success) return [];
  const fields = node.contract?.outputSchema;
  if (fields?.length) return fields.map((field, index) => ({ path: field.name.split("."), label: field.label?.trim() || `业务字段${index + 1}` })).filter((field) => InputSourcePath.safeParse(field.path).success);
  const schema = node.modelOutput?.schema ?? node.tool?.outputSchema ?? node.agentCall?.outputContract;
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  return Object.entries(properties).flatMap(([key, value], index) => {
    if (!InputSourcePath.safeParse([key]).success) return [];
    const title = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).title : null;
    return [{ path: [key], label: typeof title === "string" && title.trim() ? title : `业务字段${index + 1}` }];
  });
}

type EditResult = { ok: true; node: WorkflowNode } | { ok: false; error: string };
function validatedChange(context: ToolOperationEditorContext, node: WorkflowNode): EditResult {
  const parent = context.inline?.parent ?? context.node;
  const result = context.inline
    ? applyInlineNodeContract(context.workflow, parent, context.inline.location, context.node, node, "toolOperation")
    : applyTopLevelNodeContract(context.workflow, context.node, node, "toolOperation");
  if (!result.ok) return result;
  const next = { ...context.workflow, nodes: { ...context.workflow.nodes, [parent.id]: result.node } };
  if (!StoredWorkflow.safeParse(next).success || workflowIssue(next) || !WorkflowNode.safeParse(node).success) return { ok: false, error: "修改后完整流程无效或超过保存容量，原内容已保留。" };
  if (validateInputMappingReferences(next)) return { ok: false, error: "防重标识引用了不存在的来源步骤，原内容已保留。" };
  return { ok: true, node };
}

export function applyNodeToolOperationDraft(context: ToolOperationEditorContext, draft: ToolOperationEditorDraft, expectedSnapshot: string): EditResult {
  const state = inspectNodeToolOperation(context);
  if (!state.editable || state.snapshot !== expectedSnapshot) return { ok: false, error: state.issue ?? "步骤、流程或登记已变化，请重新打开编辑。" };
  if (!isPassiveJsonData(draft, 4096)) return { ok: false, error: "编辑内容无效，原内容已保留。" };
  const original = createToolOperationEditorDraft(context)!;
  if (canonicalJson(draft) === canonicalJson(original) && state.configured) return { ok: true, node: context.node };
  if (draft.scope !== state.config?.scope && draft.scope !== state.registration!.scope) return { ok: false, error: "请选择真实登记范围或保留当前范围。" };
  const key = draft.kind === "literal" ? { kind: "literal", value: draft.literalType === "number" ? draft.literalText.trim() ? Number(draft.literalText) : NaN : draft.literalText }
    : draft.kind === "input" ? { kind: "input", path: draft.path }
    : draft.kind === "output" ? { kind: "output", nodeId: draft.nodeId, path: draft.path } : null;
  const parsed = ToolOperationConfig.safeParse({ scope: draft.scope, key });
  if (!parsed.success) return { ok: false, error: "请选择防重范围及合法来源路径，原内容已保留。" };
  if (parsed.data.key.kind === "literal" && !validOperationLiteral(parsed.data.key.value)) return { ok: false, error: "固定标识须为最多256字的非空文字或安全整数；零有效，空值和是非值无效。" };
  const source = parsed.data.key;
  const unchangedSource = state.config && canonicalJson(source) === canonicalJson(state.config.key);
  if (!unchangedSource && source.kind === "input" && !toolOperationSources(context).inputs.some((variable) => variable.name === source.path[0])) return { ok: false, error: "请选择已定义的业务输入字段。" };
  if (!unchangedSource && source.kind === "output") {
    const output = toolOperationSources(context).outputs.find((node) => node.id === source.nodeId);
    if (!output) return { ok: false, error: "请选择当前流程中可见的业务成果来源。" };
    const availableFields = toolOperationOutputFields(output);
    if (!availableFields.some((field) => field.path.every((segment, index) => source.path[index] === segment))) return { ok: false, error: "请选择来源步骤已定义的业务成果字段，再逐级选择下级字段。" };
  }
  const config = unchangedSource ? { scope: parsed.data.scope, key: context.node.toolOperation!.key } : parsed.data;
  return validatedChange(context, { ...context.node, toolOperation: config });
}

export function clearNodeToolOperation(context: ToolOperationEditorContext, expectedSnapshot: string): EditResult {
  const state = inspectNodeToolOperation(context);
  if (!state.editable || state.snapshot !== expectedSnapshot) return { ok: false, error: state.issue ?? "步骤、流程或登记已变化，请重新打开编辑。" };
  const next = { ...context.node };
  delete next.toolOperation;
  return validatedChange(context, next);
}
