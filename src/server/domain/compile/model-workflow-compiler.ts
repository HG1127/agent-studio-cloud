import { randomUUID } from "node:crypto";
import { MAX_WAIT_DURATION_MS, WorkflowDraft } from "@/contracts/workflow";

// 旧系统 server/workflowPlanCompilerV30.mjs 的逐行移植（模型结构化计划 → WorkflowDraft）。
// 控制面细节按控制方裁定保留：条件/错误环引用回退、incoming/rewire 审批门禁重接线、
// not_approved/safe_stop/quality_review/done 四个控制面节点、unresolved 工具跳过回执核验、
// 人工前置节点直接豁免审批门禁。

const ALLOWED_TYPES = new Set([
  "ai", "human", "tool", "knowledge", "condition", "system", "subflow", "loop", "memory", "rule", "parallel", "wait", "agent_call", "handoff",
]);
const CONDITION_OPERATORS = new Set([
  "eq", "neq", "contains", "gt", "gte", "lt", "lte", "truthy", "exists",
]);

type Raw = { [key: string]: unknown };
const INFERRED_OPERATION_KIND = Symbol("inferred-operation-kind");

interface AgentRef {
  id: string;
  name: string;
  role: string;
}

interface RegistryTool {
  [key: string]: unknown;
  id: unknown;
  connectorId?: unknown;
  name?: unknown;
  title?: unknown;
  description?: unknown;
  suggestedScope?: unknown;
  capabilityKeys?: unknown[];
  status?: unknown;
  protocol?: unknown;
  risk?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  operationKind?: unknown;
  [INFERRED_OPERATION_KIND]?: boolean;
  automationPolicy?: unknown;
}

interface Cap {
  [key: string]: unknown;
  registryToolId?: unknown;
  id?: unknown;
  scope?: unknown;
  capabilityKey?: unknown;
  source?: unknown;
  action?: unknown;
  label?: unknown;
  reason?: unknown;
  protocol?: unknown;
  risk?: unknown;
  automationPolicy?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

interface ToolSpecOut {
  [key: string]: unknown;
  connector: unknown;
  action: unknown;
  intentAction: string;
  scope: unknown;
  risk: unknown;
  maxRetries: number;
  checkpointOnFailure: boolean;
  registryToolId: unknown;
  protocol: unknown;
  inputSchema: unknown;
  outputSchema: unknown;
  argumentsMode: string;
  operationKind: string;
  unresolved?: boolean;
  automationPolicy?: unknown;
  businessApprovalAccepted?: boolean;
}

interface ConditionBranchRow {
  [key: string]: unknown;
  label: string;
  value: unknown;
  next: string | null;
  rules?: Array<{ source: string; operator: unknown; value: unknown }>;
  mode?: string;
}

interface ConditionData {
  [key: string]: unknown;
  source: unknown;
  operator: unknown;
  branches: ConditionBranchRow[];
  defaultNext: unknown;
}

interface LoopData {
  [key: string]: unknown;
  bodyNext: string | null;
  exitNext: string | null;
}

interface WaitData {
  [key: string]: unknown;
  mode: unknown;
  durationMs: unknown;
  until: unknown;
  eventKey: unknown;
  eventLabel: unknown;
  payloadSchema: unknown;
  timeoutMs: unknown;
  onTimeoutNext: string | null;
}

interface ParallelData {
  [key: string]: unknown;
  strategy: unknown;
  failurePolicy: unknown;
  branches: Array<{ [key: string]: unknown; id: string; label: string; inputs: unknown[]; outputs: unknown[]; steps: Raw[] }>;
}

interface BuildNode {
  [key: string]: unknown;
  id: string;
  title: string;
  type: string;
  agent: AgentRef;
  next: string | null;
  rejectNext?: string | null;
  onErrorNext?: string | null;
  tool?: ToolSpecOut;
  condition?: ConditionData;
  loop?: LoopData;
  wait?: WaitData;
  parallel?: ParallelData;
}

interface NormalizedStep {
  [key: string]: unknown;
  id: string;
  title: string;
  type: string;
  order: number;
  owner: string;
  evidence: string;
  requirementIds: unknown[];
  dependsOn: unknown[];
  nextRef: unknown;
  rejectRef: unknown;
  errorRef: unknown;
  timeoutRef: unknown;
  condition: { [key: string]: unknown; source: unknown; operator: unknown; branches: unknown[]; defaultNext: unknown };
}

interface BindingInfo {
  stepId: string;
  toolId: unknown;
  title: unknown;
  scope: unknown;
  protocol: unknown;
  operationKind: string;
}

interface UnresolvedInfo {
  stepId: string;
  title: string;
  requested: string;
}

interface CondVarInfo {
  name: string;
  label: string;
  type: string;
  scope: string;
  required: boolean;
  description: string;
}

function clean(value: unknown, limit = 120): string {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function unique(values: unknown[] | null | undefined): unknown[] {
  return [...new Set((values || []).filter(Boolean))];
}

function safeId(value: unknown, fallback: string): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return normalized || fallback;
}

function node(id: string, title: unknown, type: string, agent: AgentRef, extra: Raw = {}): BuildNode {
  return { id, title: clean(title, 70) || "业务步骤", type, agent, next: null, ...extra } as BuildNode;
}

function isExternalTool(tool: RegistryTool | null | undefined): boolean {
  return Boolean(tool?.status === "active" && ["mcp-streamable-http", "http-json", "rest-http", "sandbox-native", "sandbox-mcp"].includes((tool.protocol ?? "http-json") as string));
}

// 旧实现原样保留（当前无调用方）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function toolCorpus(tool: RegistryTool = {} as RegistryTool): string {
  return [tool.id, tool.connectorId, tool.name, tool.title, tool.description, tool.suggestedScope, ...(tool.capabilityKeys || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function stepToolHints(step: Raw = {}): string[] {
  const tool = typeof step.tool === "object" ? (step.tool as Raw) : {};
  return unique([
    step.registryToolId,
    tool.registryToolId,
    step.toolId,
    step.toolRef,
    step.capabilityKey,
    tool.id,
    tool.name,
    tool.action,
    tool.capabilityKey,
    typeof step.tool === "string" ? step.tool : null,
    step.title,
  ]).map((value) => String(value).toLowerCase());
}

function exactTool(step: Raw, registryTools: RegistryTool[] = []): RegistryTool | null {
  const tool = typeof step.tool === "object" ? (step.tool as Raw) : {};
  const exactIds = unique([step.registryToolId, tool.registryToolId, step.toolId, tool.id]).map(String);
  const byId = registryTools.find((item) => exactIds.includes(String(item.id)) && isExternalTool(item));
  if (byId) return byId;
  const exactNames = unique([
    step.toolRef,
    step.capabilityKey,
    tool.name,
    tool.action,
    tool.capabilityKey,
    typeof step.tool === "string" ? step.tool : null,
  ]).map((value) => String(value).toLowerCase());
  const byName = registryTools
    .filter(isExternalTool)
    .filter((item) =>
      exactNames.some(
        (value) =>
          value === String(item.name || "").toLowerCase() ||
          value === String(item.suggestedScope || "").toLowerCase() ||
          (item.capabilityKeys || []).some((key) => String(key).toLowerCase() === value),
      ),
    );
  return byName.length === 1 ? byName[0] : null;
}

function capabilityTool(step: Raw, caps: Cap[] = [], registryTools: RegistryTool[] = []): RegistryTool | null {
  const matched = exactTool(step, registryTools);
  if (matched) return matched;
  const hints = stepToolHints(step);
  const cap = (caps || []).find(
    (item) =>
      hints.includes(String(item.registryToolId || "").toLowerCase()) ||
      hints.includes(String(item.id || "").toLowerCase()) ||
      hints.includes(String(item.scope || "").toLowerCase()) ||
      hints.includes(String(item.capabilityKey || "").toLowerCase()),
  );
  if (cap?.registryToolId && cap.source !== "connected-registry") return registryTools.find((item) => item.id === cap.registryToolId && isExternalTool(item)) || null;
  if (cap?.source === "connected-registry") {
    return {
      id: cap.registryToolId,
      connectorId: cap.id,
      name: cap.action,
      title: cap.label,
      description: cap.reason,
      protocol: cap.protocol,
      risk: cap.risk,
      suggestedScope: cap.scope,
      inputSchema: cap.inputSchema,
      outputSchema: cap.outputSchema,
      status: "active",
      operationKind: ["read", "action"].includes(cap.operationKind as string) ? cap.operationKind : /read|query|list|search/i.test(String(cap.action || "")) ? "read" : "action",
      [INFERRED_OPERATION_KIND]: !["read", "action"].includes(cap.operationKind as string),
      automationPolicy: cap.automationPolicy,
      capabilityKeys: [cap.capabilityKey].filter(Boolean),
    };
  }
  return null;
}

function operationKind(step: Raw, tool: RegistryTool | null): "read" | "action" {
  if (tool && (tool.protocol === "mcp-streamable-http" || (tool.protocol ?? "http-json") === "http-json" && !tool[INFERRED_OPERATION_KIND])
    && ["read", "action"].includes(tool.operationKind as string)) return tool.operationKind as "read" | "action";
  const raw = typeof step.tool === "object" ? (step.tool as Raw) : {};
  if (["read", "action"].includes(raw.operationKind as string)) return raw.operationKind as "read" | "action";
  if (["read", "action"].includes(step.operationKind as string)) return step.operationKind as "read" | "action";
  if (tool && ["read", "action"].includes(tool.operationKind as string)) return tool.operationKind as "read" | "action";
  return /读取|查询|搜索|检索|获取|查看|列出|read|get|list|search|query|fetch/i.test(`${step.title || ""} ${tool?.name || ""}`) ? "read" : "action";
}

function intentAction(step: Raw, kind: string): string {
  const raw = typeof step.tool === "object" ? (step.tool as Raw) : {};
  if (raw.intentAction) return clean(raw.intentAction, 60);
  if (step.intentAction) return clean(step.intentAction, 60);
  if (kind === "read") return "read_records";
  if (/发送|通知|提醒|send|notify|message/i.test(String(step.title || ""))) return "send_content";
  if (/创建|新增|提交|create|add|post/i.test(String(step.title || ""))) return "create_record";
  if (/删除|取消|撤销|delete|remove|cancel/i.test(String(step.title || ""))) return "delete_record";
  return "update_record";
}

function toToolSpec(step: Raw, tool: RegistryTool | null): ToolSpecOut {
  const kind = operationKind(step, tool);
  const raw = typeof step.tool === "object" ? (step.tool as Raw) : {};
  const maxRetries = Math.max(1, Math.min(8, Number((step.retry as Raw | undefined)?.maxAttempts || raw.maxRetries || (kind === "read" ? 2 : 3))));
  if (!tool) {
    return {
      connector: "unbound",
      action: clean(raw.action || step.toolRef || step.toolId || step.capabilityKey || "unbound_tool", 80),
      intentAction: intentAction(step, kind),
      scope: clean(raw.scope || step.capabilityKey || "unbound.tool", 120),
      risk: "high",
      maxRetries,
      checkpointOnFailure: true,
      registryToolId: null,
      protocol: "unbound",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      argumentsMode: "auto",
      operationKind: kind,
      unresolved: true,
    };
  }
  return {
    connector: tool.connectorId,
    action: tool.name,
    intentAction: intentAction(step, kind),
    scope: tool.suggestedScope,
    risk: tool.risk || "high",
    maxRetries,
    checkpointOnFailure: true,
    registryToolId: tool.id,
    protocol: tool.protocol ?? "http-json",
    inputSchema: tool.inputSchema || { type: "object" },
    outputSchema: tool.outputSchema || { type: "object" },
    argumentsMode: "auto",
    operationKind: kind,
    automationPolicy: tool.automationPolicy || "approval_required",
  };
}

function normalizeStep(raw: unknown, index: number, used: Set<string>): NormalizedStep {
  const source = (typeof raw === "string" ? { title: raw } : raw || {}) as Raw;
  let id = safeId(source.id || source.stepId, `step_${index + 1}`);
  while (used.has(id)) id = `${id}_${index + 1}`;
  used.add(id);
  let type = String(source.type || "ai").toLowerCase();
  if (!ALLOWED_TYPES.has(type)) type = "ai";
  const title = clean(source.title || source.action || source.name || `业务步骤 ${index + 1}`, 70);
  const condition = source.condition && typeof source.condition === "object" ? (source.condition as Raw) : {};
  const branches = Array.isArray(condition.branches) ? condition.branches : Array.isArray(source.branches) ? source.branches : [];
  return {
    ...source,
    id,
    title,
    type,
    order: index + 1,
    owner: clean(source.owner || "", 36),
    evidence: clean(source.evidence || title, 180),
    requirementIds: unique((source.requirementIds as unknown[]) || []),
    dependsOn: unique((source.dependsOn as unknown[]) || []),
    nextRef: source.nextStepId || source.next || null,
    rejectRef: source.rejectNextStepId || source.rejectNext || null,
    errorRef: source.onFailureNextStepId || source.onErrorNextStepId || source.onErrorNext || null,
    timeoutRef: (source.wait as Raw | undefined)?.onTimeoutNextStepId || source.onTimeoutNextStepId || null,
    condition: {
      ...condition,
      source: condition.source || source.source || null,
      operator: condition.operator || source.operator || null,
      branches,
      defaultNext: condition.defaultNextStepId || condition.defaultNext || source.defaultNextStepId || source.defaultNext || null,
    },
  };
}

function refResolver(steps: NormalizedStep[]): (ref: unknown) => string | null {
  const map = new Map<string, string>();
  steps.forEach((step, index) => {
    for (const key of [step.id, step.stepId, `step_${index + 1}`, `intent_${index + 1}`, String(index + 1)]) {
      if (key) map.set(String(key), step.id);
    }
  });
  return (ref) => (ref === null || ref === undefined ? null : map.get(String(ref)) || null);
}

function incoming(nodes: Record<string, BuildNode>, target: string): BuildNode[] {
  return Object.values(nodes).filter(
    (item) =>
      item.next === target ||
      item.rejectNext === target ||
      item.onErrorNext === target ||
      (item.type === "condition" &&
        ((item.condition?.branches || []).some((branch) => branch.next === target) || item.condition?.defaultNext === target)) ||
      (item.type === "loop" && (item.loop?.bodyNext === target || item.loop?.exitNext === target)) ||
      (item.type === "wait" && item.wait?.onTimeoutNext === target),
  );
}

function rewire(nodes: Record<string, BuildNode>, target: string, replacement: string): void {
  for (const item of incoming(nodes, target)) {
    if (item.next === target) item.next = replacement;
    if (item.rejectNext === target) item.rejectNext = replacement;
    if (item.onErrorNext === target) item.onErrorNext = replacement;
    if (item.type === "condition") {
      const condition = item.condition;
      for (const branch of condition?.branches || []) if (branch.next === target) branch.next = replacement;
      if (condition && condition.defaultNext === target) condition.defaultNext = replacement;
    }
    if (item.type === "loop") {
      const loop = item.loop;
      if (loop && loop.bodyNext === target) loop.bodyNext = replacement;
      if (loop && loop.exitNext === target) loop.exitNext = replacement;
    }
    if (item.type === "wait") {
      const wait = item.wait;
      if (wait && wait.onTimeoutNext === target) wait.onTimeoutNext = replacement;
    }
  }
}

function highImpact(tool: ToolSpecOut | null | undefined): boolean {
  if (tool?.risk === "high") return true;
  if (tool?.operationKind === "action" && tool?.automationPolicy !== "automatic_allowed") return true;
  if (tool?.automationPolicy === "automatic_allowed") return false;
  return (
    tool?.operationKind === "action" &&
    /delete|payment|pay|external|mail|write|send|comment|issue|create|删除|付款|支付|外发|发送|评论|创建/i.test(
      `${tool?.action || ""} ${tool?.intentAction || ""}`,
    )
  );
}

function conditionVariable(source: unknown, title: string): CondVarInfo | null {
  const raw = String(source || "").trim();
  if (!raw) return null;
  let name = raw;
  if (name.startsWith("input.")) name = name.slice(6);
  else if (name.startsWith("variables.")) name = name.slice(10);
  else if (name.startsWith("context.")) {
    name = name.slice(8);
    if (name.startsWith("variables.")) name = name.slice(10);
    if (name.startsWith("input.")) name = name.slice(6);
  }
  if (!name || name.includes(".") || name.startsWith("_")) return null;
  return {
    name,
    label: title,
    type: /amount|total|score|count|number|price|费用|金额/i.test(name) ? "number" : /is_|has_|connected|status|isVIP|wifi/i.test(name) ? "boolean" : "string",
    scope: "run",
    required: true,
    description: `用于判断“${title}”`,
  };
}

function waitSpec(step: Raw): WaitData {
  const raw = step.wait && typeof step.wait === "object" ? (step.wait as Raw) : {};
  let mode = String(raw.mode || step.waitMode || "").toLowerCase();
  if (!["delay", "until", "event"].includes(mode)) mode = raw.eventKey || step.eventKey ? "event" : raw.until || step.until ? "until" : "delay";
  const durationMs = Math.max(0, Math.min(MAX_WAIT_DURATION_MS, Number(raw.durationMs || step.durationMs || 0)));
  const timeoutMs = Math.max(0, Math.min(MAX_WAIT_DURATION_MS, Number(raw.timeoutMs || step.timeoutMs || 0)));
  return {
    mode,
    durationMs,
    until: raw.until || step.until || null,
    eventKey: clean(raw.eventKey || step.eventKey || step.id, 80),
    eventLabel: clean(raw.eventLabel || step.eventLabel || step.title, 100),
    payloadSchema: raw.payloadSchema || { type: "object" },
    timeoutMs,
    onTimeoutNext: null,
  };
}

function compileInlineStep(
  raw: unknown,
  index: number,
  ctx: { caps: Cap[]; registryTools: RegistryTool[]; bindings: BindingInfo[]; unresolvedTools: UnresolvedInfo[]; parentRef: string },
): Raw {
  const { caps, registryTools, bindings, unresolvedTools, parentRef } = ctx;
  const source = (typeof raw === "string" ? { title: raw } : structuredClone(raw || {})) as Raw;
  const type = ALLOWED_TYPES.has(String(source.type || "ai").toLowerCase()) ? String(source.type || "ai").toLowerCase() : "ai";
  const id = safeId(source.id || source.stepId, `branch_step_${index + 1}`);
  const step = {
    ...source,
    id,
    title: clean(source.title || source.action || `并行工作 ${index + 1}`, 70),
    type,
    evidence: clean(source.evidence || source.title, 180),
    businessSpec: source.businessSpec && typeof source.businessSpec === "object" ? structuredClone(source.businessSpec) : null,
    retry: source.retry || null,
    onErrorNext: source.onErrorNextStepId || source.onFailureNextStepId || source.onErrorNext || null,
  } as Raw;
  if (type === "ai") step.modelClass = source.modelClass || "balanced";
  if (type === "knowledge") step.knowledge = source.knowledge || { space: "业务知识库", query: step.evidence || step.title };
  if (type === "human") step.approval = source.approval || { role: source.owner || "业务负责人", reason: `确认“${step.title}”后继续` };
  if (type === "tool") {
    const matched = capabilityTool(source, caps, registryTools);
    const spec = toToolSpec(source, matched);
    step.tool = spec;
    if (matched) {
      bindings.push({
        stepId: `${parentRef}/${id}`,
        toolId: matched.id,
        title: matched.title || matched.name,
        scope: matched.suggestedScope,
        protocol: spec.protocol,
        operationKind: spec.operationKind,
      });
    } else {
      unresolvedTools.push({
        stepId: `${parentRef}/${id}`,
        title: step.title as string,
        requested:
          clean(source.toolRef || source.toolId || source.capabilityKey || (typeof source.tool === "string" ? source.tool : ""), 90) ||
          "未指明具体能力",
      });
    }
  }
  if (type === "wait") step.wait = waitSpec(source);
  if (type === "parallel") step.parallel = source.parallel || { strategy: "all", failurePolicy: "fail_fast", branches: [] };
  return step;
}

function hasTool(steps: Raw[] = []): boolean {
  return steps.some(
    (step) =>
      step.type === "tool" ||
      (step.type === "parallel" && (((step.parallel as Raw | undefined)?.branches as Raw[] | undefined) || []).some((branch) => hasTool((branch.steps as Raw[]) || []))) ||
      (step.type === "subflow" && hasTool((((step.subflow as Raw | undefined)?.steps as Raw[]) || []) as Raw[])),
  );
}

export function compileModelWorkflowPlan(options: {
  name?: string;
  domain?: { name?: string };
  intent: { orderedSteps?: unknown[]; trigger?: unknown; outputs?: unknown[]; [key: string]: unknown };
  caps?: unknown[];
  registryTools?: unknown[];
  humanReasons?: string[];
  sourceText?: string;
}): { workflow: WorkflowDraft; orderedSteps: unknown[]; diagnostics: Record<string, unknown> } | null {
  const { name = "业务 Agent", domain = { name: "通用业务" }, intent = {}, caps = [], registryTools = [], humanReasons = [], sourceText = "" } = options;
  const capList = caps as Cap[];
  const registryList = registryTools as RegistryTool[];
  const rawSteps = Array.isArray(intent?.orderedSteps) ? intent.orderedSteps : [];
  if (rawSteps.length < 2) return null;
  const used = new Set<string>();
  const steps = rawSteps.slice(0, 24).map((item, index) => normalizeStep(item, index, used));
  const resolve = refResolver(steps);
  const root: AgentRef = { id: `agt_${randomUUID().slice(0, 8)}`, name, role: `${domain?.name || "业务"}助手` };
  const nodes: Record<string, BuildNode> = {};
  const trigger = intent.trigger && typeof intent.trigger === "object" ? (intent.trigger as Raw) : { value: intent.trigger || "收到业务任务" };
  nodes.start = node(
    "start",
    trigger.value || "收到业务任务",
    "trigger",
    root,
    trigger.schedule ? { trigger: { kind: "schedule", schedule: trigger.schedule }, description: "到达已确认的运行时间后自动开始" } : { description: "收到本次业务输入后开始" },
  );
  const bindings: BindingInfo[] = [];
  const unresolvedTools: UnresolvedInfo[] = [];
  for (const step of steps) {
    const extra: Raw = {
      description: step.evidence,
      sourceLabel: "AI 结构化理解",
      intentEvidence: { text: step.evidence, source: step.source || "model", stepRef: step.id },
      businessSpec: step.businessSpec || null,
      requirementIds: step.requirementIds,
      dependsOn: step.dependsOn,
      retry: {
        maxAttempts: Math.max(1, Math.min(8, Number((step.retry as Raw | undefined)?.maxAttempts || 1))),
        backoffMs: Math.max(50, Math.min(60000, Number((step.retry as Raw | undefined)?.backoffMs || 250))),
      },
    };
    if (step.type === "ai") {
      Object.assign(extra, {
        modelClass: step.modelClass || (/规划|判断|推理|分析/.test(step.title) ? "reasoning" : "balanced"),
        purpose: step.purpose || "execute",
      });
    }
    if (step.type === "knowledge") extra.knowledge = step.knowledge || { space: "业务知识库", query: step.evidence || step.title };
    if (step.type === "human") {
      Object.assign(extra, {
        approval: {
          role: (step.approval as Raw | undefined)?.role || step.owner || "业务负责人",
          reason: (step.approval as Raw | undefined)?.reason || `确认“${step.title}”后流程才会继续`,
        },
        rejectNext: null,
      });
    }
    if (step.type === "tool") {
      const matched = capabilityTool(step, capList, registryList);
      const spec = toToolSpec(step, matched);
      extra.tool = spec;
      if (matched) {
        bindings.push({
          stepId: step.id,
          toolId: matched.id,
          title: matched.title || matched.name,
          scope: matched.suggestedScope,
          protocol: spec.protocol,
          operationKind: spec.operationKind,
        });
      } else {
        unresolvedTools.push({
          stepId: step.id,
          title: step.title,
          requested: clean(step.toolRef || step.toolId || step.capabilityKey || (typeof step.tool === "string" ? step.tool : ""), 90) || "未指明具体能力",
        });
      }
    }
    if (step.type === "condition") {
      extra.condition = {
        source: step.condition.source || `input.condition_${step.order}`,
        operator: CONDITION_OPERATORS.has(step.condition.operator as string) ? step.condition.operator : "eq",
        branches: [],
        defaultNext: null,
      };
    }
    if (step.type === "subflow") {
      extra.subflow =
        step.subflow ||
        { name: step.title, steps: [{ title: "读取输入" }, { title: "执行子任务" }, { title: "返回结果" }], inputs: ["业务上下文"], outputs: ["子流程结果"], failurePolicy: "checkpoint" };
    }
    if (step.type === "loop") {
      extra.loop = step.loop || { collectionPath: "context.records", itemKey: "currentItem", maxIterations: 100, bodyNext: null, exitNext: null };
    }
    if (step.type === "wait") extra.wait = waitSpec(step);
    if (step.type === "parallel") {
      const raw = step.parallel && typeof step.parallel === "object" ? (step.parallel as Raw) : {};
      const branches = (Array.isArray(raw.branches) ? raw.branches : Array.isArray(step.branches) ? step.branches : []) as Raw[];
      extra.parallel = {
        strategy: (["all", "any", "all_settled"] as string[]).includes(raw.strategy as string) ? raw.strategy : "all",
        failurePolicy: (["fail_fast", "continue"] as string[]).includes(raw.failurePolicy as string) ? raw.failurePolicy : "fail_fast",
        branches: branches.slice(0, 12).map((branchRaw, branchIndex) => {
          const branch = branchRaw as Raw;
          const branchId = safeId(branch.id, `branch_${branchIndex + 1}`);
          return {
            id: branchId,
            label: clean(branch.label || branch.title || `并行工作 ${branchIndex + 1}`, 70),
            inputs: unique((branch.inputs as unknown[]) || []),
            outputs: unique((branch.outputs as unknown[]) || ["分支结果"]),
            steps: ((branch.steps as unknown[]) || [])
              .slice(0, 24)
              .map((child, childIndex) =>
                compileInlineStep(child, childIndex, {
                  caps: capList,
                  registryTools: registryList,
                  bindings,
                  unresolvedTools,
                  parentRef: `${step.id}/${branchId}`,
                }),
              ),
          };
        }),
      };
    }
    if (step.type === "memory") {
      extra.memory = step.memory || { mode: /保存|记录|写入/.test(step.title) ? "write" : "read", query: clean(sourceText, 180) };
    }
    if (step.type === "agent_call") {
      extra.agentCall = step.agentCall || {
        targetAgentId: "",
        versionId: "",
        targetAgentName: "",
        memoryAccess: { mode: "none" },
        inputContract: { fields: [] },
        outputContract: { fields: [] },
      };
    }
    if (step.type === "handoff") {
      extra.toAgent = step.toAgent || { id: "", name: "", versionId: "" };
      extra.contract = step.contract || {
        deliverables: [],
        mustNotInclude: ["密钥和访问令牌", "与本次任务无关的个人隐私", "未确认的内部草稿"],
        inputSchema: [],
        outputSchema: [],
        memoryPolicy: { mode: "none", shared: [], private: ["密钥", "个人隐私", "内部草稿"] },
      };
    }
    if (step.type === "rule") extra.rule = step.rule || { kind: "business_rule" };
    nodes[step.id] = node(step.id, step.title, step.type, root, extra);
  }
  nodes.not_approved = node(
    "not_approved",
    "未获确认，保留当前结果并停止高影响动作",
    "system",
    root,
    { description: "拒绝后不执行后续外发、付款、删除或写回操作", controlPlane: { kind: "safety", hiddenByDefault: true } },
  );
  nodes.not_approved.next = "quality_review";
  nodes.safe_stop = node(
    "safe_stop",
    "条件不满足，本次流程安全结束",
    "system",
    root,
    { description: "没有匹配到明确业务路径时，不猜测、不执行高影响动作", controlPlane: { kind: "safety", hiddenByDefault: true } },
  );
  nodes.safe_stop.next = "quality_review";
  nodes.quality_review = node(
    "quality_review",
    "交付前核对结果与系统回执",
    "rule",
    root,
    {
      controlPlane: { kind: "quality", hiddenByDefault: true },
      quality: {
        requiredOutputTitles: ((intent.outputs as unknown[]) || [])
          .map((item) => clean(typeof item === "string" ? item : (item as Raw | undefined)?.name, 80))
          .filter(Boolean) as string[],
        minOutputCount: 1,
        checkToolReceipts: hasTool(steps),
        checkHumanBoundary: steps.some((step) => step.type === "human"),
      },
      description: "结束前确认已形成结果、外部系统返回回执，且应由员工决定的步骤已有记录",
    },
  );
  nodes.quality_review.next = "done";
  nodes.done = node(
    "done",
    clean(
      (((intent.outputs as unknown[]) || []).slice(-1).map((item) => (typeof item === "string" ? item : (item as Raw | undefined)?.name)).filter(Boolean)[0] as string) ||
        "本次业务任务已完成",
      70,
    ),
    "end",
    root,
    { description: "结果、执行轨迹和人工决定均已保存" },
  );
  nodes.start.next = steps[0].id;
  const branchEntryIds = new Set(
    steps
      .filter((step) => step.type === "condition")
      .flatMap((step) => [
        ...((step.condition.branches as Raw[]) || []).map((branch) => resolve((branch as Raw).nextStepId || (branch as Raw).next)),
        resolve(step.condition.defaultNext),
      ])
      .filter(Boolean) as string[],
  );
  const errorTargetIds = new Set(steps.map((step) => resolve(step.errorRef)).filter(Boolean) as string[]);
  const rejectTargetIds = new Set(steps.map((step) => resolve(step.rejectRef)).filter(Boolean) as string[]);
  const stepIndexMap = new Map(steps.map((s, i) => [s.id, i] as const));
  steps.forEach((step, index) => {
    const current = nodes[step.id];
    const candidate = steps[index + 1]?.id || null;
    const skipInto = candidate && (branchEntryIds.has(candidate) || errorTargetIds.has(candidate) || rejectTargetIds.has(candidate));
    const linear = skipInto ? "quality_review" : candidate || "quality_review";
    let explicit = resolve(step.nextRef);
    if (explicit && step.type !== "loop") {
      const expIdx = stepIndexMap.get(explicit);
      if (expIdx !== undefined && expIdx <= index) {
        explicit = "quality_review";
      }
    }
    let errorTarget = resolve(step.errorRef);
    if (errorTarget && step.type !== "loop") {
      const errIdx = stepIndexMap.get(errorTarget);
      if (errIdx !== undefined && errIdx <= index) {
        errorTarget = null;
      }
    }
    if (step.type === "condition") {
      const branches: ConditionBranchRow[] = [];
      for (const branchRaw of (step.condition.branches as Raw[]) || []) {
        const branch = branchRaw as Raw;
        let next = resolve(branch.nextStepId || branch.next);
        if (!next) continue;
        const bIdx = stepIndexMap.get(next);
        if (bIdx !== undefined && bIdx <= index) next = "quality_review";
        const row: ConditionBranchRow = {
          label: clean(branch.label || String(branch.value ?? "满足条件"), 60),
          value: branch.value !== undefined ? branch.value : true,
          next,
        };
        if (Array.isArray(branch.rules)) {
          row.rules = (branch.rules as Raw[])
            .filter((rule) => rule && rule.source)
            .map((rule) => ({
              source: clean(rule.source, 120),
              operator: CONDITION_OPERATORS.has(rule.operator as string) ? rule.operator : "eq",
              value: rule.value,
            }));
        }
        if (branch.mode === "any") row.mode = "any";
        branches.push(row);
      }
      if (!branches.length) branches.push({ label: "满足条件", value: step.condition.value !== undefined ? step.condition.value : true, next: explicit || linear });
      (current.condition as ConditionData).branches = branches;
      let defNext = resolve(step.condition.defaultNext) || "safe_stop";
      const defIdx = stepIndexMap.get(defNext);
      if (defIdx !== undefined && defIdx <= index) defNext = "safe_stop";
      (current.condition as ConditionData).defaultNext = defNext;
    } else if (step.type === "loop") {
      const loopRef = (step.loop as Raw | undefined) || {};
      const loopData = current.loop as LoopData;
      loopData.bodyNext = resolve(loopRef.bodyNextStepId || loopRef.bodyNext) || linear;
      loopData.exitNext = resolve(loopRef.exitNextStepId || loopRef.exitNext) || "quality_review";
    } else {
      current.next = explicit || linear;
      if (step.type === "human") current.rejectNext = resolve(step.rejectRef) || "not_approved";
    }
    current.onErrorNext = errorTarget;
    if (step.type === "wait") (current.wait as WaitData).onTimeoutNext = resolve(step.timeoutRef) || null;
  });
  for (const step of steps.filter((item) => item.type === "tool")) {
    const current = nodes[step.id] as BuildNode & { tool: ToolSpecOut };
    const spec = current.tool;
    if (spec.unresolved) continue;
    if (spec.operationKind === "action") {
      const verifyId = `verify_${step.id}`;
      const originalNext = current.next || "quality_review";
      nodes[verifyId] = node(
        verifyId,
        `确认“${step.title}”已取得系统回执`,
        "rule",
        root,
        {
          controlPlane: { kind: "receipt", hiddenByDefault: true },
          rule: { kind: "tool_result", sourceNodeId: step.id, requireBusinessReceipt: true },
          description: "只有真实工具返回成功结果且通过输出格式校验，流程才会继续",
        },
      );
      nodes[verifyId].next = originalNext;
      current.next = verifyId;
    }
  }
  for (const step of steps.filter((item) => item.type === "tool" && highImpact(nodes[item.id]?.tool))) {
    const current = nodes[step.id] as BuildNode & { tool: ToolSpecOut };
    const previous = incoming(nodes, step.id);
    if (previous.length && previous.every((item) => item.type === "human")) {
      current.tool.businessApprovalAccepted = true;
      continue;
    }
    const guardId = `approval_${step.id}`;
    rewire(nodes, step.id, guardId);
    nodes[guardId] = node(
      guardId,
      `业务负责人确认：${step.title}`,
      "human",
      root,
      {
        controlPlane: { kind: "governance", hiddenByDefault: true },
        ui: { visibility: "control" },
        approval: {
          role: (step.approval as Raw | undefined)?.role || "业务负责人",
          reason: humanReasons.join("；") || "这一步会修改外部业务系统，需要员工确认",
        },
        rejectNext: "not_approved",
      },
    );
    nodes[guardId].next = step.id;
    current.tool.businessApprovalAccepted = true;
  }
  const variables = unique(
    steps
      .filter((step) => step.type === "condition")
      .map((step) => conditionVariable((nodes[step.id]?.condition as ConditionData | undefined)?.source, step.title))
      .filter((item): item is CondVarInfo => Boolean(item))
      .map((item) => item.name),
  ).map((name) =>
    steps
      .map((step) => conditionVariable((nodes[step.id]?.condition as ConditionData | undefined)?.source, step.title))
      .find((item) => item?.name === name),
  );
  const evidenceCount = steps.filter((step) => step.evidence).length;
  const conditionCount = steps.filter((step) => step.type === "condition").length;
  const branchCount = steps
    .filter((step) => step.type === "condition")
    .reduce((sum, step) => sum + ((nodes[step.id]?.condition as ConditionData | undefined)?.branches?.length || 0) + 1, 0);
  const parallelCount = steps.filter((step) => step.type === "parallel").length;
  const parallelBranchCount = steps
    .filter((step) => step.type === "parallel")
    .reduce((sum, step) => sum + ((nodes[step.id]?.parallel as ParallelData | undefined)?.branches?.length || 0), 0);
  const waitCount = steps.filter((step) => step.type === "wait").length;
  const recoveryRouteCount = steps.filter((step) => nodes[step.id]?.onErrorNext).length;
  const diagnostics: Record<string, unknown> = {
    schema: "workflow-plan-diagnostics/v3.6",
    source: "connected-model-structured-plan",
    stepCount: steps.length,
    evidenceCount,
    conditionCount,
    branchCount,
    parallelCount,
    parallelBranchCount,
    waitCount,
    recoveryRouteCount,
    toolBindings: bindings,
    unresolvedTools,
    coverage: {
      stepsWithEvidence: evidenceCount,
      totalSteps: steps.length,
      percent: Math.round((evidenceCount / Math.max(1, steps.length)) * 100),
    },
    warnings: [
      ...unresolvedTools.map((item) => `“${item.title}”尚未绑定真实工具`),
      ...steps
        .filter((step) => step.type === "condition" && !step.condition.source)
        .map((step) => `“${step.title}”未说明判断数据来源，已改为运行输入`),
      ...steps
        .filter((step) => step.type === "parallel" && ((nodes[step.id]?.parallel as ParallelData | undefined)?.branches?.length || 0) < 2)
        .map((step) => `“${step.title}”至少需要两项可同时执行的工作`),
      ...steps
        .filter(
          (step) =>
            step.type === "wait" &&
            (nodes[step.id]?.wait as WaitData | undefined)?.mode === "event" &&
            !(nodes[step.id]?.wait as WaitData | undefined)?.eventKey,
        )
        .map((step) => `“${step.title}”缺少等待消息标识`),
    ],
  };
  const built = {
    workflow: {
      id: `WF-${randomUUID()}`,
      versionId: null,
      startNodeId: "start",
      rootAgent: root,
      nodes,
      variables,
      memoryPolicy: {
        taskContext: true,
        longTerm: steps.some((step) => step.type === "memory"),
        description: steps.some((step) => step.type === "memory") ? "只按流程中明确的记忆步骤读取或保存经验" : "仅保留本次任务所需信息",
      },
      runtimeRequirements: { externalTools: bindings, unresolvedTools, toolReceiptVerification: true },
      intentSource: {
        mode: "model-structured-plan-v3.6",
        schema: "workflow-plan/v3.6",
        sourceText: clean(sourceText, 500),
        orderedSteps: steps.map((step) => ({
          id: step.id,
          title: step.title,
          type: step.type,
          evidence: step.evidence,
          requirementIds: step.requirementIds,
        })),
        diagnostics,
      },
    },
    orderedSteps: steps,
    diagnostics,
  };
  // 仅校验不替换：Zod 解析会补默认值并剥离旧遗留字段，直接返回解析结果会破坏金测对齐（持久化方负责入库前 parse）
  WorkflowDraft.parse(built.workflow);
  return {
    workflow: built.workflow as unknown as WorkflowDraft,
    orderedSteps: built.orderedSteps,
    diagnostics: built.diagnostics,
  };
}
