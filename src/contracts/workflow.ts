import { z } from "zod";

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
  protocol: z.string(), operationKind: z.enum(["read", "action"]),
  unresolved: z.boolean().optional(),
  inputSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
  outputSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
});
export const ConditionBranch = z.object({
  label: z.string(), value: z.unknown().optional(), next: z.string().nullable(),
  rules: z.array(z.object({ source: z.string(), operator: z.string(), value: z.unknown().optional() })).optional(),
  mode: z.string().optional(),
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
  purpose: z.string().optional(),
  approval: z.object({ role: z.string(), reason: z.string() }).optional(),
  tool: ToolSpec.optional(),
  knowledge: z.object({ space: z.string(), query: z.string().optional() }).optional(),
  condition: z.object({
    source: z.string().nullable(), operator: z.string().default("eq"),
    branches: z.array(ConditionBranch).default([]), defaultNext: z.string().nullable().default(null),
  }).optional(),
  system: z.object({ kind: z.string().optional() }).optional(),
  rule: z.object({ kind: z.string(), sourceNodeId: z.string().optional(), requireBusinessReceipt: z.boolean().optional() }).optional(),
  quality: z.object({
    requiredOutputTitles: z.array(z.string()).default([]), minOutputCount: z.number().default(1),
    checkToolReceipts: z.boolean().default(false), checkHumanBoundary: z.boolean().default(false),
  }).optional(),
  loop: z.object({ collectionPath: z.string(), itemKey: z.string(), maxIterations: z.number().int().min(1).max(100), bodyNext: z.string().nullable(), exitNext: z.string().nullable() }).optional(),
  parallel: z.object({ strategy: z.enum(["all", "any", "all_settled"]), failurePolicy: z.enum(["fail_fast", "continue"]), branches: z.array(z.unknown()) }).optional(),
  wait: z.object({ mode: z.enum(["delay", "until", "event"]), durationMs: z.number().default(0), until: z.string().nullable().default(null), eventKey: z.string(), eventLabel: z.string().optional(), payloadSchema: z.record(z.string(), z.unknown()).default({ type: "object" }), timeoutMs: z.number().default(0), onTimeoutNext: z.string().nullable().default(null) }).optional(),
  memory: z.object({ mode: z.string(), query: z.string().optional(), limit: z.number().optional(), contentFrom: z.string().optional() }).optional(),
  subflow: z.object({ name: z.string(), steps: z.array(z.unknown()).default([]), inputs: z.array(z.string()).default([]), outputs: z.array(z.string()).default([]), failurePolicy: z.string().optional() }).optional(),
  agentCall: z.object({ targetAgentId: z.string(), versionId: z.string(), targetAgentName: z.string().optional(), inputContract: z.record(z.string(), z.unknown()).optional(), outputContract: z.record(z.string(), z.unknown()).optional() }).optional(),
  toAgent: z.object({ id: z.string() }).optional(),
  businessSpec: z.record(z.string(), z.unknown()).nullable().default(null),
});
export const WorkflowDraft = z.object({
  id: z.string(), versionId: z.string().nullable().default(null),
  startNodeId: z.string().default("start"),
  rootAgent: z.object({ id: z.string(), name: z.string(), role: z.string() }),
  nodes: z.record(z.string(), WorkflowNode),
  variables: z.array(z.object({ name: z.string(), label: z.string().optional(), type: z.string().default("string"), scope: z.string().default("run"), required: z.boolean().default(true), description: z.string().optional() })).default([]),
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
  outputContract: z.object({ fields: z.array(z.object({ path: z.string(), label: z.string().optional(), required: z.boolean().default(true), sourceNodeId: z.string().optional() })).default([]) }).optional(),
  ui: z.object({ positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).default({}) }).default({ positions: {} }),
});
export type WorkflowNodeType = z.infer<typeof WorkflowNodeType>;
export type WorkflowNode = z.infer<typeof WorkflowNode>;
export type WorkflowDraft = z.infer<typeof WorkflowDraft>;
