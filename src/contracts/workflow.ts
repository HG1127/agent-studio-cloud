import { z } from "zod";
import { JsonStorageValue } from "./json";
import { ModelOutputConfig } from "./model-output";
import { InputMapping, InputSourcePath } from "./input-mapping";
import { ToolOperationConfig } from "./tool-operation";
import { RUN_DELIVERY_INTENT_KEY } from "./run-delivery-config";

const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);
const RESERVED_WORKFLOW_NODE_IDS: ReadonlySet<string> = new Set([
  RUN_DELIVERY_INTENT_KEY,
  ...RESERVED_FIELD_NAMES,
  ...Object.getOwnPropertyNames(Object.prototype),
]);
const safeFieldPath = (value: string) => value.split(".").every((segment) => segment.length > 0 && !RESERVED_FIELD_NAMES.has(segment));
const safeTopLevelNodeId = (value: string) => value.length <= 200
  && /^[A-Za-z0-9_-]+$/.test(value)
  && !RESERVED_WORKFLOW_NODE_IDS.has(value);
const omitUndefined = <T extends object>(value: T): T => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== undefined),
) as T;
const InlineStepData = z.record(z.string(), z.unknown()).transform((step) => {
  if (step.contract !== undefined) return step;
  const storedStep = { ...step };
  delete storedStep.contract;
  return storedStep;
});

export const MAX_WORKFLOW_NODES = 200;
export const MAX_KNOWLEDGE_SOURCES_PER_NODE = 100;
export const MAX_WORKFLOW_BYTES = 1024 * 1024;
export const MAX_CONDITION_BRANCHES = 20;
export const MAX_PARALLEL_BRANCHES = 8;
export const MAX_PARALLEL_STEPS = 20;
export const MAX_SUBFLOW_STEPS = 50;
export const MAX_WORKFLOW_VARIABLES = 100;
export const MAX_WORKFLOW_OUTPUT_FIELDS = 100;
export const MAX_WAIT_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export const WorkflowNodeType = z.enum([
  "trigger", "end", "ai", "human", "tool", "knowledge", "condition",
  "system", "subflow", "loop", "memory", "rule", "parallel", "wait",
  "agent_call", "handoff",
]);
export const NodeControlPlane = z.object({
  kind: z.enum(["safety", "quality", "receipt", "governance", "delivery", "audit", "idempotency"]),
  hiddenByDefault: z.boolean(),
  reason: z.string().optional(),
});
export const ToolSpec = z.object({
  connector: z.string(), action: z.string(),
  intentAction: z.string().optional(), scope: z.string(), risk: z.enum(["low", "medium", "high"]).default("high"),
  maxRetries: z.number().int().min(1).max(8).default(3),
  registryToolId: z.string().nullable().default(null),
  protocol: z.string(), operationKind: z.enum(["read", "action"]).optional(), // 旧意图编译器 toolSpec 不产出该字段，放宽为可选
  unresolved: z.boolean().optional(),
  inputSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
  outputSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
});
export const ConditionBranch = z.object({
  label: z.string(), value: z.unknown().optional(), next: z.string().nullable(),
  rules: z.array(z.object({ source: z.string(), operator: z.string(), value: z.unknown().optional() })
    .transform(({ value, ...rule }) => ({ ...rule, ...(value === undefined ? {} : { value }) }))).optional(),
  mode: z.enum(["all", "any"]).optional(),
}).transform(({ value, rules, mode, ...branch }) => ({
  ...branch,
  ...(value === undefined ? {} : { value }),
  ...(rules === undefined ? {} : { rules }),
  ...(mode === undefined ? {} : { mode }),
}));
export const ParallelBranch = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  steps: z.array(InlineStepData).min(1).max(MAX_PARALLEL_STEPS),
});
export const HandoffField = z.object({
  name: z.string().min(1).max(200).refine(safeFieldPath, "交接字段名不能使用保留名称"),
  label: z.string().optional(),
  type: z.enum(["string", "number", "boolean", "object", "array", "any"]).default("any"),
  required: z.boolean().default(true),
});
export const HandoffContract = z.object({
  deliverables: z.array(z.string().min(1)).default([]),
  mustNotInclude: z.array(z.string().min(1)).default([]),
  inputSchema: z.array(HandoffField).default([]),
  outputSchema: z.array(HandoffField).default([]),
  memoryPolicy: z.object({
    mode: z.enum(["none", "self", "team"]).default("none"),
    shared: z.array(z.string()).default([]),
    private: z.array(z.string()).default([]),
  }).optional(),
});
export const WorkflowVariable = z.object({
  name: z.string().max(200).regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine((name) => !RESERVED_FIELD_NAMES.has(name), "运行输入字段名不能使用保留名称"),
  label: z.string().max(200).optional(),
  type: z.string().max(50).default("string"),
  scope: z.string().max(50).default("run"),
  required: z.boolean().default(true),
  description: z.string().max(1_000).optional(),
});
export const QualityGateSpec = z.object({
  requiredOutputTitles: z.array(z.string().min(1).max(200)).max(MAX_WORKFLOW_NODES).default([]),
  minOutputCount: z.number().int().min(0).max(MAX_WORKFLOW_NODES).default(1),
  checkToolReceipts: z.boolean().default(false),
  checkHumanBoundary: z.boolean().default(false),
});
export const WorkflowNode = z.object({
  id: z.string(), title: z.string(), type: WorkflowNodeType,
  agent: z.object({ id: z.string(), name: z.string(), role: z.string() }).optional(),
  next: z.string().nullable().default(null),
  rejectNext: z.string().nullable().default(null),
  onErrorNext: z.string().nullable().default(null),
  description: z.string().optional(),
  controlPlane: NodeControlPlane.optional(),
  ui: z.object({ visibility: z.enum(["business", "control"]).optional() }).optional(),
  requirementIds: z.array(z.string()).default([]),
  intentEvidence: z.object({ text: z.string(), source: z.string().optional() }).optional(),
  retry: z.object({ maxAttempts: z.number().int().min(1).max(8), backoffMs: z.number().int().min(50).max(60000) }).optional(),
  // 类型专属（宽松可选，具体节点类型由运行时 switch 消费）
  modelClass: z.string().optional(),
  modelOutput: ModelOutputConfig.optional(),
  inputMapping: InputMapping.optional(),
  toolOperation: ToolOperationConfig.optional(),
  purpose: z.string().optional(),
  approval: z.object({ role: z.string(), reason: z.string() }).optional(),
  tool: ToolSpec.optional(),
  knowledge: z.object({
    space: z.string(),
    query: z.string().optional(),
    sourceIds: z.array(z.string().uuid()).max(MAX_KNOWLEDGE_SOURCES_PER_NODE).optional(),
    selectionRequired: z.boolean().optional(),
  }).optional(),
  condition: z.object({
    source: z.string().nullable(), operator: z.string().default("eq"),
    branches: z.array(ConditionBranch).max(MAX_CONDITION_BRANCHES).default([]), defaultNext: z.string().nullable().default(null),
  }).optional(),
  system: z.object({ kind: z.string().optional() }).optional(),
  rule: z.object({ kind: z.string(), sourceNodeId: z.string().optional(), requireBusinessReceipt: z.boolean().optional() }).optional(),
  quality: QualityGateSpec.optional(),
  loop: z.object({ collectionPath: z.string(), itemKey: z.string(), maxIterations: z.number().int().min(1).max(100), bodyNext: z.string().nullable(), exitNext: z.string().nullable() }).optional(),
  parallel: z.object({ strategy: z.enum(["all", "any", "all_settled"]), failurePolicy: z.enum(["fail_fast", "continue"]), branches: z.array(ParallelBranch).max(MAX_PARALLEL_BRANCHES) }).optional(),
  wait: z.object({
    mode: z.enum(["delay", "until", "event"]),
    durationMs: z.number().default(0),
    until: z.string().nullable().default(null),
    eventKey: z.string(),
    eventLabel: z.string().optional(),
    payloadSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
    timeoutMs: z.number().default(0),
    onTimeoutNext: z.string().nullable().default(null),
  }).optional(),
  memory: z.object({ mode: z.enum(["read", "write"]), query: z.string().optional(), limit: z.number().int().min(1).max(20).optional(), contentFrom: z.string().optional() }).optional(),
  subflow: z.object({ name: z.string(), steps: z.array(InlineStepData).max(MAX_SUBFLOW_STEPS).default([]), inputs: z.array(z.string()).default([]), outputs: z.array(z.string()).default([]), failurePolicy: z.enum(["checkpoint", "continue"]).default("checkpoint") }).optional(),
  agentCall: z.object({ targetAgentId: z.string(), versionId: z.string(), targetAgentName: z.string().optional(), workflowId: z.string().optional(), memoryAccess: z.object({ mode: z.enum(["self", "team", "none"]) }).optional(), inputContract: z.record(z.string(), z.unknown()).optional(), outputContract: z.record(z.string(), z.unknown()).optional() }).optional(),
  toAgent: z.object({ id: z.string(), name: z.string().optional(), versionId: z.string().optional() }).optional(),
  contract: HandoffContract.optional(),
  businessSpec: z.record(z.string(), z.unknown()).nullable().default(null),
}).superRefine((node, context) => {
  if (node.toolOperation && (node.type !== "tool" || node.tool?.protocol === "demo")) {
    context.addIssue({ code: "custom", path: ["toolOperation"], message: "只有真实业务工具步骤可以配置跨运行操作防重" });
  }
  if (node.inputMapping && !["tool", "ai", "knowledge", "agent_call", "handoff"].includes(node.type) && !(node.type === "rule" && node.rule?.kind === "business_rule" && !node.quality)) {
    context.addIssue({ code: "custom", path: ["inputMapping"], message: "只有智能处理、业务判断、知识检索、工具和助手协作步骤可以配置输入映射" });
  }
  if (node.inputMapping?.includeUpstreamOutputs && ["knowledge", "agent_call", "handoff"].includes(node.type)) {
    context.addIssue({ code: "custom", path: ["inputMapping", "includeUpstreamOutputs"], message: "知识检索与助手协作请逐项映射需要的上游字段，不能额外携带全部成果" });
  }
  if (node.modelOutput && node.type !== "ai" && !(node.type === "rule" && node.rule?.kind === "business_rule" && !node.quality)) {
    context.addIssue({ code: "custom", path: ["modelOutput"], message: "只有智能处理和业务判断步骤可以配置模型结果字段" });
  }
}).transform(omitUndefined);
export const WorkflowOutputField = z.object({
  path: z.string().min(1).max(200),
  label: z.string().max(200).optional(),
  required: z.boolean().default(true),
  sourceNodeId: z.string().min(1).max(200).optional(),
  sourcePath: InputSourcePath.optional(),
}).superRefine((field, context) => {
  if (field.sourcePath !== undefined && !field.sourceNodeId) context.addIssue({ code: "custom", path: ["sourcePath"], message: "选择交付来源字段时必须明确业务步骤" });
});
export type WorkflowOutputField = z.infer<typeof WorkflowOutputField>;

export const WorkflowDraft = z.object({
  id: z.string(), versionId: z.string().nullable().default(null),
  startNodeId: z.string().default("start"),
  rootAgent: z.object({ id: z.string(), name: z.string(), role: z.string() }),
  nodes: z.record(z.string(), WorkflowNode).refine((nodes) => Object.keys(nodes).length <= MAX_WORKFLOW_NODES, `流程步骤不能超过 ${MAX_WORKFLOW_NODES} 个`),
  variables: z.array(WorkflowVariable).max(MAX_WORKFLOW_VARIABLES).default([]),
  memoryPolicy: z.object({ taskContext: z.boolean(), longTerm: z.boolean(), description: z.string().optional() }),
  runtimeRequirements: z.object({ externalTools: z.array(z.unknown()).default([]), unresolvedTools: z.array(z.unknown()).default([]), toolReceiptVerification: z.boolean().default(true) }).optional(),
  intentSource: z.record(z.string(), z.unknown()).optional(),
  businessRequirements: z.record(z.string(), z.unknown()).optional(),
  businessPolicies: z.record(z.string(), z.unknown()).optional(),
  businessGrounding: z.record(z.string(), z.unknown()).optional(),
  businessExecutability: z.record(z.string(), z.unknown()).optional(),
  requirementContract: z.record(z.string(), z.unknown()).optional(),
  complexityProfile: z.record(z.string(), z.unknown()).optional(),
  runtimePolicy: z.record(z.string(), z.unknown()).optional(),
  outputContract: z.object({
    fields: z.array(WorkflowOutputField).max(MAX_WORKFLOW_OUTPUT_FIELDS).default([]),
  }).optional(),
  ui: z.object({ positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).default({}) }).default({ positions: {} }),
}).superRefine((draft, ctx) => {
  for (const [nodeKey, node] of Object.entries(draft.nodes)) {
    if (!safeTopLevelNodeId(nodeKey)) {
      ctx.addIssue({ code: "custom", path: ["nodes", nodeKey], message: "步骤标识包含不安全字符或保留名称" });
    } else if (node.id !== nodeKey) {
      ctx.addIssue({ code: "custom", path: ["nodes", nodeKey, "id"], message: "步骤标识与画布记录不一致" });
    }
  }
  try {
    if (!JsonStorageValue.safeParse(draft).success) {
      ctx.addIssue({ code: "custom", message: "流程草稿必须是可保存的 JSON 数据" });
      return;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
    if (bytes > MAX_WORKFLOW_BYTES) ctx.addIssue({ code: "custom", message: "流程草稿不能超过 1MB" });
  } catch {
    ctx.addIssue({ code: "custom", message: "流程草稿必须是可序列化的 JSON" });
  }
});
export type WorkflowNodeType = z.infer<typeof WorkflowNodeType>;
export type WorkflowNode = z.infer<typeof WorkflowNode>;
export type WorkflowDraft = z.infer<typeof WorkflowDraft>;
export type ParallelBranch = z.infer<typeof ParallelBranch>;
export type HandoffContract = z.infer<typeof HandoffContract>;
export type WorkflowVariable = z.infer<typeof WorkflowVariable>;
