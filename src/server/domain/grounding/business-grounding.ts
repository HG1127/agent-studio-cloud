// 旧系统 server/businessGroundingV57.mjs 的逐行移植（业务需求抽取 + 落地门禁 + 工作流落地）。
// 依赖 Task 4 的 isConversationalOrMeta/stripGoalPreamble 与 contracts/workflow 的 WorkflowDraft。
import { createHash } from "node:crypto";
import { WorkflowDraft } from "@/contracts/workflow";
import { isConversationalOrMeta, stripGoalPreamble } from "@/server/domain/intent";
import { normalizeForbiddenActions } from "./business-policy";

export interface GroundingIntent {
  [key: string]: unknown;
  orderedSteps?: Array<{ id?: string | null; title?: string; evidence?: string | null }>;
  trigger?: { value?: string } | string;
  outputs?: Array<string | { name?: string; basis?: string }>;
  inputs?: Array<string | { name?: string }>;
  forbiddenActions?: string[];
}

export interface GroundingContext {
  sourceText?: string;
  intent?: GroundingIntent;
  answers?: Record<string, unknown>;
}

export interface GroundingSpecInput {
  [key: string]: unknown;
  path?: string;
  label?: string;
  source?: string;
}

export interface GroundingNodeGrounding {
  [key: string]: unknown;
  status?: string;
  score?: number;
  requirementIds?: string[];
  sourceSnippets?: string[];
  executionSnippets?: string[];
  derivedFrom?: string;
}

export interface GroundingOutputField {
  [key: string]: unknown;
  path?: string;
  label?: string;
  required?: boolean;
  source?: string;
}

export interface ExecutionSource {
  [key: string]: unknown;
  kind: string;
  id?: string;
  label?: string;
  verified: boolean;
}

export interface GroundingBlocker {
  [key: string]: unknown;
  kind: string;
  nodeId?: string;
  title?: string;
  path?: string;
  branchId?: string;
  question: string;
  detail: string;
}

export interface GroundingExecutability {
  [key: string]: unknown;
  schema: string;
  status: string;
  businessNodeCount: number;
  executableNodeCount: number;
  blockerCount: number;
  coveragePercent: number;
  blockers: GroundingBlocker[];
  policy: string;
}

export interface BusinessExecutabilityAmbiguity {
  id: string;
  question: string;
  default: string;
  reason: string;
  suggestions: string[];
}

export interface GroundingBusinessSpec {
  [key: string]: unknown;
  schema?: string;
  objective?: string;
  inputs?: GroundingSpecInput[];
  rules?: string[];
  outputs?: Array<string | { label?: string; path?: string }>;
  doneWhen?: string[];
  evidence?: string[];
  executionEvidence?: string[];
  assumptions?: unknown[];
  grounding?: GroundingNodeGrounding | null;
  executability?: { status?: string; sources?: ExecutionSource[]; missingSources?: GroundingBlocker[]; checkedAt?: string };
}

export interface GroundingNode {
  [key: string]: unknown;
  id?: string;
  title?: string;
  type?: string;
  description?: string;
  next?: string | null;
  rejectNext?: string | null;
  onErrorNext?: string | null;
  requirementIds?: string[];
  evidence?: string;
  ui?: { visibility?: string; [key: string]: unknown } | null;
  controlPlane?: { kind?: string; hiddenByDefault?: boolean; reason?: string; [key: string]: unknown } | null;
  intentEvidence?: { text?: string; source?: string } | null;
  approval?: { role?: string; reason?: string; [key: string]: unknown } | null;
  tool?: {
    [key: string]: unknown;
    scope?: string;
    action?: string;
    intentAction?: string;
    registryToolId?: string | null;
    connector?: string;
    protocol?: string;
    risk?: string;
    maxRetries?: number;
    unresolved?: boolean;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  } | null;
  knowledge?: {
    [key: string]: unknown;
    space?: string;
    query?: string;
    kind?: string;
    builtin?: boolean;
    standardId?: string;
    sourceIds?: string[];
  } | null;
  condition?: GroundingCondition | null;
  system?: { kind?: string; [key: string]: unknown } | null;
  rule?: { kind?: string; sourceNodeId?: string; [key: string]: unknown } | null;
  wait?: GroundingWait | null;
  loop?: GroundingLoop | null;
  parallel?: { strategy?: string; failurePolicy?: string; branches?: unknown[]; [key: string]: unknown } | null;
  agentCall?: {
    [key: string]: unknown;
    targetAgentId?: string;
    versionId?: string;
    targetAgentName?: string;
    inputContract?: { fields?: unknown[]; [key: string]: unknown } | null;
    outputContract?: { fields?: unknown[]; [key: string]: unknown } | null;
  } | null;
  toAgent?: { id?: string; [key: string]: unknown } | null;
  subflow?: {
    [key: string]: unknown;
    name?: string;
    steps?: unknown[];
    outputs?: Array<string | { label?: string; path?: string }>;
    failurePolicy?: string;
    workflow?: { outputContract?: { fields?: GroundingOutputField[] }; [key: string]: unknown } | null;
  } | null;
  contract?: { deliverables?: unknown[]; [key: string]: unknown } | null;
  operation?: { kind?: string; [key: string]: unknown } | null;
  businessSpec?: GroundingBusinessSpec | null;
}

export interface GroundingBranch {
  [key: string]: unknown;
  label?: string;
  value?: unknown;
  next?: string | null;
  rules?: GroundingRuleRow[];
  mode?: string;
}

export interface GroundingRuleRow {
  [key: string]: unknown;
  source?: string;
  operator?: string;
  value?: unknown;
  label?: string;
}

export interface GroundingCondition {
  [key: string]: unknown;
  source?: string | null;
  operator?: string;
  branches?: GroundingBranch[];
  defaultNext?: string | null;
}

export interface GroundingWait {
  [key: string]: unknown;
  mode?: string;
  durationMs?: number;
  until?: string | null;
  eventKey?: string;
  eventLabel?: string;
  timeoutMs?: number;
  onTimeoutNext?: string | null;
  timeoutNext?: string | null;
  spec?: { eventKey?: string; [key: string]: unknown } | null;
}

export interface GroundingLoop {
  [key: string]: unknown;
  collectionPath?: string;
  itemKey?: string;
  maxIterations?: number;
  bodyNext?: string | null;
  exitNext?: string | null;
}

export interface GroundingParallelBranch {
  [key: string]: unknown;
  id?: string;
  label?: string;
  steps?: unknown[];
}

export interface GroundingContractField {
  [key: string]: unknown;
  path?: string;
  name?: string;
  label?: string;
  required?: boolean;
  sourceNodeId?: string;
  sourceNodeIds?: string[];
}

export interface GroundingWorkflow {
  [key: string]: unknown;
  id?: string;
  nodes?: Record<string, GroundingNode>;
  variables?: Array<{ name?: string; [key: string]: unknown }>;
  outputContract?: { fields?: GroundingContractField[]; [key: string]: unknown } | null;
  resourceSelection?: { knowledgeSourceIds?: string[]; [key: string]: unknown } | null;
  businessPolicies?: { forbiddenActions?: string[]; [key: string]: unknown } | null;
  businessRequirements?: Record<string, unknown> | null;
  businessGrounding?: Record<string, unknown> | null;
  businessExecutability?: { blockers?: GroundingBlocker[]; status?: string; coveragePercent?: number; blockerCount?: number; [key: string]: unknown } | null;
}

export interface GroundingRequirement {
  id: string;
  type: string;
  text: string;
  source: string;
  explicit: boolean;
  confidence: number;
}

export interface RequirementMatch {
  r: GroundingRequirement;
  score: number;
  derivedFrom?: string;
}

interface SourcePathStatus {
  known: boolean;
  kind: string;
  path?: string;
  nodeId?: string | undefined;
  nodeIds?: Array<string | undefined>;
}

const CONTROL_IDS = /^(quality_review|safe_stop|not_approved|archive|exception_review|verify_|delivery_)/;
const GENERIC_TITLES =
  /^(读取业务资料与上下文|理解输入|理解业务输入|分析判断|智能分析|生成结构化结果|整理结果|汇总结果|继续处理下一项条件|汇合业务分支|先安排处理顺序与所需信息|执行子任务|返回结果|本次业务任务完成|本次任务完成)$/;
const ACTION_RE =
  /(读取|查询|检索|搜索|整理|提取|分析|判断|识别|比较|计算|匹配|生成|起草|改写|发送|通知|提醒|创建|更新|写回|记录|审批|确认|复核|等待|汇总|输出|交付|保存|归档|调用|同步|监控)/i;
const NEG_RE =
  /(?:不要|无需|无须|禁止|不得|不允许|不需要|避免|不能|不可|不(?=(?:写回|发送|发邮件|邮件|更新|删除|创建|通知|支付|付款|发布)))/;
const DATA_FETCH_RE = /^(?:读取|查询|获取|拉取|检索|搜索|查找|查看|加载|抓取)/i;

function clean(value: unknown, limit = 240): string {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function unique<T>(values: T[] | null | undefined): NonNullable<T>[] {
  return [...new Set((values || []).filter((item): item is NonNullable<T> => Boolean(item)))];
}

function tokens(value: unknown): Set<string> {
  const source = String(value || "").toLowerCase();
  const out = new Set(source.match(/[a-z][a-z0-9_.-]{2,}/g) || []);
  for (const block of source.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let i = 0; i < block.length - 1; i++) out.add(block.slice(i, i + 2));
  }
  return out;
}

function overlap(a: unknown, b: unknown): number {
  const tokenA = tokens(a);
  const tokenB = tokens(b);
  if (!tokenA.size || !tokenB.size) return 0;
  let hits = 0;
  for (const token of tokenA) if (tokenB.has(token)) hits += 1;
  return hits / Math.max(1, Math.min(tokenA.size, tokenB.size));
}

function splitClauses(text = ""): string[] {
  return String(text || "")
    .split(/[。！？!?；;\n\r]+/)
    .map((item) => clean(item, 320))
    .filter((item) => item.length >= 2);
}

function expandClause(clause: string): string[] {
  if (NEG_RE.test(clause)) return normalizeForbiddenActions([clause]);
  const subparts = clause
    .split(/[，,]+/)
    .map((item) => clean(item, 180))
    .filter((item) => item.length >= 2);
  if (subparts.length > 1) {
    const result: string[] = [];
    for (const part of subparts) {
      if (NEG_RE.test(part)) result.push(...normalizeForbiddenActions([part]));
      else result.push(part);
    }
    return result;
  }
  const trigger = clause.match(/^((?:收到|接到|当|一旦).{1,80}?(?:后|时))[，,]\s*(.+)$/);
  if (trigger) return [trigger[1], trigger[2]];
  const conditional = clause.match(/^((?:如果|若).+?)[，,]\s*(.+)$/);
  if (conditional) return [conditional[1], conditional[2]];
  return [clause];
}

function reqType(text = ""): string {
  if (NEG_RE.test(text)) return "constraint";
  if (/每天|每周|每月|定时|收到.+后|当.+时|一旦.+时|触发|启动/.test(text) && !ACTION_RE.test(text.replace(/收到|触发|启动/g, ""))) return "trigger";
  if (/如果|若|阈值|超过|低于|高于|≥|≤|>=|<=|>|<|满足|不满足/.test(text)) return "condition";
  if (/^(?:最终|最后)?(?:输出|交付|返回|呈现)|形成.+结果|生成.+报告/.test(text)) return "output";
  if (/必须|只能|需要.{0,8}(确认|审批|复核)|人工/.test(text)) return "constraint";
  if (/失败|异常|重试|超时|备用|兜底/.test(text)) return "exception";
  if (/谁|负责人|销售|财务|法务|hr|员工|主管/.test(text) && !ACTION_RE.test(text)) return "actor";
  if (/输入|提供|上传|资料|文档|数据|字段|名单|记录/.test(text) && !ACTION_RE.test(text)) return "input";
  return ACTION_RE.test(text) ? "action" : "context";
}

function reqId(index: number, text: string): string {
  return `BR-${String(index + 1).padStart(3, "0")}-${createHash("sha1").update(text).digest("hex").slice(0, 6)}`;
}

export function extractBusinessRequirements(context: GroundingContext = {}): GroundingRequirement[] {
  const { sourceText = "", intent = {}, answers = {} } = context;
  const rows: GroundingRequirement[] = [];
  for (const raw of splitClauses(sourceText)) {
    if (isConversationalOrMeta(raw)) continue;
    const strippedRaw = stripGoalPreamble(raw);
    const targetRaw = strippedRaw && !isConversationalOrMeta(strippedRaw) ? strippedRaw : raw;
    for (const clause of expandClause(targetRaw)) {
      if (isConversationalOrMeta(clause)) continue;
      const stripped = stripGoalPreamble(clause);
      const finalClause = stripped && !isConversationalOrMeta(stripped) ? stripped : clause;
      if (isConversationalOrMeta(finalClause)) continue;
      const type = reqType(finalClause);
      if (type === "context" && finalClause.length > 180) continue;
      rows.push({ id: "", type, text: finalClause, source: "user", explicit: true, confidence: 1 });
    }
  }
  const trigger = clean((intent?.trigger as { value?: string } | undefined)?.value || intent?.trigger || "");
  if (trigger && !isConversationalOrMeta(trigger) && !rows.some((r) => r.type === "trigger" && overlap(r.text, trigger) > 0.72)) {
    rows.push({ id: "", type: "trigger", text: trigger, source: "intent", explicit: true, confidence: 0.9 });
  }
  for (const item of intent?.outputs || []) {
    const name = clean(typeof item === "string" ? item : item?.name);
    const basis = typeof item === "string" ? undefined : item?.basis;
    if (name && !isConversationalOrMeta(name) && !rows.some((r) => r.type === "output" && overlap(r.text, name) > 0.65)) {
      rows.push({
        id: "",
        type: "output",
        text: name,
        source: "intent",
        explicit: basis === "explicit" || basis === "confirmed",
        confidence: basis === "explicit" || basis === "confirmed" ? 1 : 0.72,
      });
    }
  }
  for (const [key, value] of Object.entries(answers || {})) {
    const text = clean(value);
    if (text && !isConversationalOrMeta(text)) {
      rows.push({
        id: "",
        type: key === "output" ? "output" : key === "trigger" ? "trigger" : key === "approval" ? "constraint" : "context",
        text,
        source: `answer:${key}`,
        explicit: true,
        confidence: 1,
      });
    }
  }
  const dedup: GroundingRequirement[] = [];
  for (const row of rows) {
    if (isConversationalOrMeta(row.text)) continue;
    const found = dedup.find((x) => x.type === row.type && (x.text === row.text || overlap(x.text, row.text) > 0.9));
    if (found) {
      if (row.explicit && !found.explicit) Object.assign(found, row);
      continue;
    }
    dedup.push(row);
  }
  return dedup.slice(0, 48).map((row, index) => ({ ...row, id: reqId(index, row.text) }));
}

function nodeCorpus(node: GroundingNode): string {
  return clean(
    [
      node?.title,
      node?.description,
      node?.intentEvidence?.text,
      node?.tool?.scope,
      node?.tool?.action,
      node?.approval?.reason,
      node?.condition?.source,
      ...(node?.condition?.branches || []).map((branch) => branch.label),
      node?.businessSpec?.objective,
      ...(node?.businessSpec?.rules || []),
      ...(node?.businessSpec?.outputs || []),
    ]
      .filter(Boolean)
      .join(" "),
    1200,
  );
}

function controlPlaneKind(node: GroundingNode = {}, workflow: GroundingWorkflow | null = null): string | null {
  if (node.controlPlane?.kind) return node.controlPlane.kind;
  if (CONTROL_IDS.test(String(node.id || ""))) {
    const id = String(node.id || "");
    return id.startsWith("verify_") ? "receipt" : id.includes("quality") ? "quality" : id.includes("not_approved") || id.includes("safe_stop") || id.includes("archive") ? "safety" : "delivery";
  }
  if (node.type === "rule" && ["tool_result", "tool_receipt"].includes(String(node.rule?.kind))) return "receipt";
  if (node.type === "rule" && ["attendance_slot_guard", "idempotency_guard", "dedupe_guard"].includes(String(node.rule?.kind))) return "idempotency";
  if (node.type === "rule" && ["required_input", "input_guard", "prompt_quality", "quality_guard", "schema_validation", "input_validation"].includes(String(node.rule?.kind))) return "quality";
  if (node.type === "system" && node.system?.kind === "deliver_output") return "delivery";
  if (node.type === "system" && ["audit_record", "runtime_audit", "checkpoint_record"].includes(String(node.system?.kind))) return "audit";
  if (node.type === "condition" && workflow) {
    const paths = [
      node.condition?.source,
      ...(node.condition?.branches || []).flatMap((branch) => (branch.rules || []).map((rule) => rule.source)),
    ].filter((item): item is string => Boolean(item));
    const controlSource = paths.find((path) => {
      const m = String(path).match(/^context\.outputs\.([^.]+)/);
      const up = m && workflow.nodes?.[m[1]];
      return (
        up &&
        (up.controlPlane?.hiddenByDefault === true ||
          ["attendance_slot_guard", "idempotency_guard", "dedupe_guard", "tool_receipt", "tool_result"].includes(String(up.rule?.kind)) ||
          ["audit_record", "runtime_audit"].includes(String(up.system?.kind)))
      );
    });
    if (controlSource) return "governance";
  }
  const safetyText = clean(`${node.title || ""} ${node.description || ""} ${node.intentEvidence?.text || ""}`, 260);
  if (node.type === "system" && /(?:保留.*(?:草稿|当前结果).*(?:停止|不再)|停止(?:发送|外发|写回|后续)|未获.*(?:确认|批准)|拒绝后|不执行后续)/.test(safetyText)) return "safety";
  return null;
}

function requiredToolInputs(node: GroundingNode): GroundingSpecInput[] {
  const schema = (node?.tool?.inputSchema || {}) as { required?: string[]; properties?: Record<string, { title?: string; description?: string }> };
  const required = new Set(schema.required || []);
  return Object.entries(schema.properties || {})
    .filter(([name]) => required.has(name))
    .map(([name, item]) => ({ path: name, label: clean(item?.title || item?.description || name, 80), source: "tool-contract" }));
}

function outputFieldsFor(node: GroundingNode, workflow: GroundingWorkflow): GroundingOutputField[] {
  const candidates = (workflow?.outputContract?.fields || []).filter(
    (field) => field.sourceNodeId === node.id || ((field.sourceNodeIds || []).length === 1 && (field.sourceNodeIds || [])[0] === node.id),
  );
  if (candidates.length) {
    return candidates.map((field) => ({
      path: field.path || field.name,
      label: field.label || field.path || field.name,
      required: field.required !== false,
      source: "workflow-output-contract",
    }));
  }
  if (node.type === "tool") {
    const schema = (node.tool?.outputSchema || {}) as { required?: string[]; properties?: Record<string, { title?: string; description?: string }> };
    const props = schema.properties || {};
    const keys = Object.keys(props).slice(0, 8);
    const derived = nodeDerivedOutputs(node);
    return keys.map((name) => ({
      path: name,
      label: clean(props[name]?.title || props[name]?.description || (keys.length === 1 ? derived[0] : null) || name, 80),
      required: (schema.required || []).includes(name),
      source: "tool-contract",
    }));
  }
  return [];
}

function branchRules(node: GroundingNode): string[] {
  if (node.type !== "condition") return [];
  const out: string[] = [];
  for (const branch of node.condition?.branches || []) {
    const rules = branch.rules?.length
      ? branch.rules
      : [{ source: node.condition?.source, operator: node.condition?.operator || "eq", value: branch.value }];
    for (const rule of rules) {
      out.push(`${branch.label || "满足条件"}：${rule.source || "业务条件"} ${rule.operator || "eq"} ${String(rule.value)}`);
    }
  }
  if (node.condition?.defaultNext) out.push("未命中上述条件时走“否则”路径");
  return out;
}

function splitOutputPhrase(text = ""): string[] {
  const value = clean(text, 140);
  if (!value) return [];
  const parts = value
    .split(/(?:和|与|、|以及)/)
    .map((item) => clean(item, 100))
    .filter((item) => item.length >= 2);
  return parts.length >= 2 && parts.length <= 4 ? parts : [value];
}

function nodeDerivedOutputs(node: GroundingNode): string[] {
  let title = clean(node?.title || "", 120);
  if (/[：:]/.test(title)) title = clean(title.split(/[：:]/).slice(1).join("："), 120);
  if (node?.type === "condition") return ["判断结果与命中依据"];
  if (node?.type === "human") return ["人工决定"];
  if (node?.type === "knowledge") return ["检索到的事实与来源"];
  const m = title.match(/^(?:最终|最后)?(?:读取|查询|获取|提取|生成|形成|输出|整理|汇总|计算|识别|判断|分析)(.+)$/);
  return m ? splitOutputPhrase(m[1]) : [];
}

function observableDoneWhen(node: GroundingNode, structuredOutputs: GroundingOutputField[], outputNames: string[]): string[] {
  if (node.type === "trigger") return ["已收到真实触发事件或必需输入，并记录触发来源"];
  if (node.type === "end") return ["所有必需业务输出均已通过验收并形成最终结果"];
  if (node.type === "condition") return ["已记录命中的业务分支与用于判断的实际数据值"];
  if (node.type === "human") return ["已记录指定负责人的明确决定、备注与时间"];
  if (node.type === "tool")
    return ["真实工具调用成功并取得可核验回执", ...structuredOutputs.filter((o) => o.required).map((o) => `回执中存在“${o.label}”`)];
  if (node.type === "wait") return ["收到约定事件/到达约定时间，或按超时策略进入明确路径"];
  if (node.type === "loop") return ["每个待处理项均完成业务步骤，或集合为空时按退出路径结束"];
  if (node.type === "parallel") return [`${node.parallel?.branches?.length || 0} 个并行分支按 ${node.parallel?.strategy || "all"} 策略汇总`];
  if (node.type === "knowledge") return ["返回与本步骤目标直接相关的事实，并保留资料来源"];
  if (outputNames.length) return outputNames.map((name) => `已生成非空的“${name}”，且可被下游或最终验收读取`);
  return ["产生与本步骤需求证据一致的非空业务结果，并可被下一业务步骤读取"];
}

function nodeInputs(node: GroundingNode): GroundingSpecInput[] {
  const result: GroundingSpecInput[] = [];
  const seen = new Set<string>();
  const add = (path: string | undefined, label: string, source: string) => {
    if (path && !seen.has(path)) {
      seen.add(path);
      result.push({ path, label, source });
    }
  };
  if (node.type === "condition") {
    if (node.condition?.source) add(node.condition.source, "判断数据", "condition-source");
    for (const branch of node.condition?.branches || []) {
      for (const rule of branch.rules || []) add(rule.source, rule.label || "判断数据", "condition-rule");
    }
  }
  if (node.type === "loop" && node.loop?.collectionPath) add(node.loop.collectionPath, "待逐项处理的数据", "loop-source");
  if (node.type === "wait" && node.wait?.eventKey) add(node.wait.eventKey, node.wait.eventLabel || "等待事件", "wait-contract");
  for (const item of requiredToolInputs(node)) add(item.path, item.label || item.path || "", item.source || "tool-contract");
  return result;
}

function matchRequirements(node: GroundingNode, requirements: GroundingRequirement[]): RequirementMatch[] {
  const corpus = nodeCorpus(node);
  const title = clean(node.title, 180);
  const explicitEvidence = clean(node.intentEvidence?.text || node.description || node.evidence || "", 260);
  const scored = requirements
    .map((r) => {
      let score = overlap(corpus, r.text);
      if (title && (r.text === title || String(r.text).includes(title) || title.includes(r.text))) score = Math.max(score, 0.98);
      if (explicitEvidence && (String(r.text).includes(explicitEvidence) || String(explicitEvidence).includes(r.text))) score = Math.max(score, 0.92);
      if (node.type === "condition" && r.type === "condition") score = Math.max(score, 0.86);
      if (node.type === "tool" && r.type === "action") score += 0.08;
      if (node.type === "human" && r.type === "constraint") score += 0.15;
      return { r, score: Math.min(1, score) };
    })
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  const cutoff = top >= 0.9 ? Math.max(0.7, top - 0.16) : Math.max(0.35, top - 0.2);
  return scored.filter((x) => x.score >= cutoff).slice(0, 3);
}

function isGenericUngrounded(node: GroundingNode, matches: string[]): boolean {
  return (
    ["ai", "system", "knowledge", "rule"].includes(String(node.type)) &&
    GENERIC_TITLES.test(clean(node.title, 120)) &&
    matches.length === 0 &&
    !controlPlaneKind(node)
  );
}

function incomingRefs(nodes: Record<string, GroundingNode>, target: string | undefined): Array<[Record<string, unknown>, string]> {
  const refs: Array<[Record<string, unknown>, string]> = [];
  for (const n of Object.values(nodes)) {
    if (n.next === target) refs.push([n, "next"]);
    if (n.rejectNext === target) refs.push([n, "rejectNext"]);
    if (n.onErrorNext === target) refs.push([n, "onErrorNext"]);
    if (n.type === "condition") {
      const condition = n.condition as GroundingCondition;
      for (const branch of condition?.branches || []) if (branch.next === target) refs.push([branch, "next"]);
      if (condition?.defaultNext === target) refs.push([condition, "defaultNext"]);
    }
    if (n.type === "wait") {
      const wait = n.wait as GroundingWait;
      if (wait?.onTimeoutNext === target || wait?.timeoutNext === target) {
        refs.push([wait, wait.onTimeoutNext === target ? "onTimeoutNext" : "timeoutNext"]);
      }
    }
    if (n.type === "loop") {
      const loop = n.loop as GroundingLoop;
      if (loop?.bodyNext === target) refs.push([loop, "bodyNext"]);
      if (loop?.exitNext === target) refs.push([loop, "exitNext"]);
    }
  }
  return refs;
}

function predecessorNodes(nodes: Record<string, GroundingNode>, target: string | undefined): GroundingNode[] {
  const ids: Array<string | undefined> = [];
  for (const n of Object.values(nodes)) {
    if (n.next === target || n.rejectNext === target || n.onErrorNext === target) ids.push(n.id);
    if (n.type === "condition") {
      for (const branch of n.condition?.branches || []) if (branch.next === target) ids.push(n.id);
      if (n.condition?.defaultNext === target) ids.push(n.id);
    }
    if (n.type === "loop" && (n.loop?.bodyNext === target || n.loop?.exitNext === target)) ids.push(n.id);
    if (n.type === "wait" && (n.wait?.onTimeoutNext === target || n.next === target)) ids.push(n.id);
  }
  return unique(ids)
    .map((id) => nodes[id])
    .filter(Boolean);
}

function removeLinear(nodes: Record<string, GroundingNode>, id: string): boolean {
  const n = nodes[id];
  if (!n || !n.next || ["trigger", "end", "condition", "human", "tool", "wait", "loop", "parallel", "agent_call", "handoff"].includes(String(n.type))) return false;
  for (const [obj, key] of incomingRefs(nodes, id)) obj[key] = n.next;
  delete nodes[id];
  return true;
}

function genericSimilarity(a: GroundingNode, b: GroundingNode): number {
  return overlap(`${a.title} ${a.intentEvidence?.text || ""}`, `${b.title} ${b.intentEvidence?.text || ""}`);
}

function collapseDuplicates(nodes: Record<string, GroundingNode>): number {
  let changed = 0;
  for (const n of Object.values({ ...nodes })) {
    if (!n?.next || !nodes[n.next]) continue;
    const m = nodes[n.next];
    if (!["ai", "system", "knowledge"].includes(String(n.type)) || n.type !== m.type) continue;
    const a = n.businessSpec?.grounding?.requirementIds || [];
    const b = m.businessSpec?.grounding?.requirementIds || [];
    const shared = a.some((x) => b.includes(x));
    if (shared && genericSimilarity(n, m) > 0.62 && !controlPlaneKind(n) && !controlPlaneKind(m)) {
      n.title = clean(`${n.title} / ${m.title}`, 70);
      n.description = unique([n.description, m.description]).join("；").slice(0, 360);
      n.businessSpec = {
        ...n.businessSpec,
        rules: unique([...(n.businessSpec?.rules || []), ...(m.businessSpec?.rules || [])]),
        outputs: unique([...(n.businessSpec?.outputs || []), ...(m.businessSpec?.outputs || [])]),
        doneWhen: unique([...(n.businessSpec?.doneWhen || []), ...(m.businessSpec?.doneWhen || [])]),
      };
      n.next = m.next;
      delete nodes[String(m.id)];
      changed += 1;
    }
  }
  return changed;
}

function inputNames(intent: GroundingIntent): Set<string> {
  return new Set(
    (intent.inputs || [])
      .map((x) => (typeof x === "string" ? x : x?.name))
      .filter(Boolean)
      .map((x) => String(x).trim().toLowerCase()),
  );
}

function knownRuntimeInput(path: unknown, intent: GroundingIntent): boolean {
  const p = String(path || "").replace(/^\$\./, "");
  if (!p.startsWith("input.")) return false;
  const name = p.slice("input.".length).split(".")[0].toLowerCase();
  const names = inputNames(intent);
  return names.has(name) || ["task", "text", "message", "payload", "record", "records", "data", "amount", "purchasedays"].includes(name);
}

function executableTool(node: GroundingNode = {}): boolean {
  const tool = node.tool || {};
  return (
    node.type === "tool" &&
    !tool.unresolved &&
    tool.protocol !== "unbound" &&
    tool.connector !== "unbound" &&
    !/^unbound\./.test(String(tool.scope || "")) &&
    !!(tool.registryToolId || tool.connector || tool.scope)
  );
}

function knowledgeBound(workflow: GroundingWorkflow, node: GroundingNode = {}): boolean {
  const selected = workflow?.resourceSelection?.knowledgeSourceIds || [];
  const space = String(node.knowledge?.space || "").trim();
  return Boolean(
    node.type === "knowledge" &&
      (selected.length > 0 ||
        (space && !/^(业务知识库|knowledge|知识库)$/i.test(space)) ||
        node.knowledge?.kind === "builtin_prompt_standard" ||
        node.knowledge?.kind === "builtin" ||
        node.knowledge?.builtin === true ||
        !!node.knowledge?.standardId ||
        !!(node.knowledge?.sourceIds || []).length),
  );
}

function agentBound(node: GroundingNode = {}): boolean {
  return node.type === "agent_call" && !!node.agentCall?.targetAgentId && !!node.agentCall?.versionId;
}

function executionContractEvidence(workflow: GroundingWorkflow, node: GroundingNode = {}): string[] {
  const out: string[] = [];
  if (executableTool(node)) {
    out.push(`已绑定真实工具：${node.tool?.action || node.title}（${node.tool?.scope || node.tool?.registryToolId || "已注册能力"}）`);
  }
  if (knowledgeBound(workflow, node)) {
    out.push(`已绑定真实知识来源：${node.knowledge?.space || (workflow.resourceSelection?.knowledgeSourceIds || []).join("、")}`);
  }
  if (agentBound(node)) {
    out.push(`已绑定已发布 Agent：${node.agentCall?.targetAgentName || node.agentCall?.targetAgentId} · ${node.agentCall?.versionId}`);
  }
  const ruleUpstream = node.rule?.sourceNodeId ? workflow?.nodes?.[node.rule.sourceNodeId] : undefined;
  if (node.type === "rule" && ruleUpstream) out.push(`基于上游“${ruleUpstream.title}”的真实执行结果`);
  if (node.type === "condition") {
    const paths = [
      node.condition?.source,
      ...(node.condition?.branches || []).flatMap((branch) => (branch.rules || []).map((rule) => rule.source)),
    ].filter((item): item is string => Boolean(item));
    for (const path of unique(paths)) {
      const m = String(path).match(/^context\.outputs\.([^.]+)/);
      const upstream = m ? workflow?.nodes?.[m[1]] : undefined;
      if (upstream) out.push(`判断字段来自上游“${upstream.title}”的输出`);
      else if (String(path).startsWith("input.")) out.push(`判断字段来自运行输入：${path}`);
      else if (String(path).startsWith("variables.")) out.push(`判断字段来自流程变量：${path}`);
    }
  }
  return unique(out).slice(0, 6);
}

function sourcePathStatus(path: unknown, workflow: GroundingWorkflow, intent: GroundingIntent, node: GroundingNode): SourcePathStatus {
  const value = String(path || "").replace(/^\$\./, "");
  if (!value) return { known: false, kind: "missing" };
  if (value.startsWith("input.")) return { known: true, kind: knownRuntimeInput(value, intent) ? "runtime-input" : "runtime-input-inferred", path: value };
  if (value.startsWith("variables.")) {
    const name = value.slice("variables.".length).split(".")[0];
    const exists = (workflow.variables || []).some((v) => v?.name === name);
    return { known: exists, kind: exists ? "workflow-variable" : "missing-variable", path: value };
  }
  if (value.startsWith("context.outputs.")) {
    const id = value.slice("context.outputs.".length).split(".")[0];
    const upstream = workflow.nodes?.[id];
    return { known: !!upstream, kind: upstream ? "upstream-output" : "missing-upstream", path: value, nodeId: id };
  }
  if (value.startsWith("context.businessData.")) {
    const upstream = predecessorNodes(workflow.nodes || {}, node.id).filter((n) => executableTool(n) || knowledgeBound(workflow, n) || agentBound(n));
    return { known: upstream.length > 0, kind: upstream.length ? "upstream-business-data" : "unresolved-business-data", path: value, nodeIds: upstream.map((n) => n.id) };
  }
  if (value.startsWith("context.currentItem.")) return { known: true, kind: "loop-item", path: value };
  if (value.startsWith("context.")) return { known: true, kind: "runtime-context", path: value };
  const bare = value.split(".")[0];
  const variable = (workflow.variables || []).find((v) => String(v?.name || "") === bare);
  if (variable) return { known: true, kind: "workflow-variable", path: `variables.${value}` };
  if (knownRuntimeInput(`input.${value}`, intent)) return { known: true, kind: "runtime-input", path: `input.${value}` };
  const predecessors = predecessorNodes(workflow.nodes || {}, node?.id);
  const upstream = predecessors.find((n) => {
    const props = ((n?.tool?.outputSchema || {}) as { properties?: Record<string, unknown> }).properties || {};
    return (
      Object.prototype.hasOwnProperty.call(props, bare) ||
      (n?.businessSpec?.outputs || []).some((x) => String(x) === bare || String(x).includes(bare))
    );
  });
  if (upstream) return { known: true, kind: "upstream-output-field", path: value, nodeId: upstream.id };
  return { known: false, kind: "unresolved-path", path: value };
}

function executionSources(workflow: GroundingWorkflow, node: GroundingNode, intent: GroundingIntent, answers: Record<string, unknown> = {}): ExecutionSource[] {
  const sources: ExecutionSource[] = [];
  if (executableTool(node)) {
    sources.push({ kind: "tool", id: node.tool?.registryToolId || node.tool?.connector || node.tool?.scope, label: node.tool?.scope || node.title, verified: true });
  }
  if (knowledgeBound(workflow, node)) {
    sources.push({
      kind: "knowledge",
      id: (workflow.resourceSelection?.knowledgeSourceIds || [])[0] || node.knowledge?.space,
      label: node.knowledge?.space || "知识资料",
      verified: true,
    });
  }
  if (agentBound(node)) {
    sources.push({ kind: "agent", id: node.agentCall?.targetAgentId, label: node.agentCall?.targetAgentName || node.agentCall?.targetAgentId, verified: true });
  }
  for (const item of node.businessSpec?.inputs || []) {
    const status = sourcePathStatus(item.path, workflow, intent, node);
    if (status.known) sources.push({ kind: status.kind, id: status.path || item.path, label: item.label || item.path, verified: true });
  }
  const confirmed = String(answers?.[`data_source_${node.id}`] || "").trim();
  if (confirmed && /(用户|运行时|表单|上传|手动提供|输入)/.test(confirmed)) {
    sources.push({ kind: "confirmed-runtime-input", id: "input", label: confirmed, verified: true });
  }
  return sources;
}

function nodeSourceGaps(workflow: GroundingWorkflow, node: GroundingNode, intent: GroundingIntent, answers: Record<string, unknown> = {}): GroundingBlocker[] {
  if (!node || node.ui?.visibility === "control" || ["trigger", "end"].includes(String(node.type))) return [];
  const gaps: GroundingBlocker[] = [];
  const spec = node.businessSpec || {};
  const sources = executionSources(workflow, node, intent, answers);
  if (node.type === "tool" && !executableTool(node)) {
    gaps.push({
      kind: "tool_source",
      nodeId: node.id,
      title: node.title,
      question: `“${node.title}”需要调用哪个真实系统或工具？`,
      detail: "当前步骤是 Tool 节点，但没有绑定可验证的 registryTool / connector / scope。",
    });
  }
  if (node.type === "knowledge" && !knowledgeBound(workflow, node)) {
    gaps.push({
      kind: "knowledge_source",
      nodeId: node.id,
      title: node.title,
      question: `“${node.title}”应该从哪个知识库、文档集或资料源读取？`,
      detail: "当前知识步骤没有选择真实知识源。",
    });
  }
  if (
    DATA_FETCH_RE.test(clean(node.title || spec.objective || "", 160)) &&
    !["tool", "knowledge", "agent_call"].includes(String(node.type)) &&
    !sources.some((x) =>
      ["tool", "knowledge", "agent", "upstream-output", "upstream-output-field", "upstream-business-data", "runtime-input", "runtime-input-inferred", "confirmed-runtime-input"].includes(
        x.kind,
      ),
    )
  ) {
    gaps.push({
      kind: "data_source",
      nodeId: node.id,
      title: node.title,
      question: `“${node.title}”的数据具体从哪里来？`,
      detail: "该步骤要求读取/查询/获取业务数据，但当前没有真实 Tool、Knowledge、Runtime Input 或上游输出来源。",
    });
  }
  if (node.type === "condition") {
    const paths = [
      node.condition?.source,
      ...(node.condition?.branches || []).flatMap((branch) => (branch.rules || []).map((rule) => rule.source)),
    ].filter((item): item is string => Boolean(item));
    if (!paths.length) {
      gaps.push({
        kind: "condition_contract",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”具体根据哪个字段判断？`,
        detail: "条件节点没有声明可追溯的判断字段。",
      });
    }
    for (const path of unique(paths)) {
      const status = sourcePathStatus(path, workflow, intent, node);
      if (!status.known) {
        gaps.push({
          kind: "condition_source",
          nodeId: node.id,
          title: node.title,
          path,
          question: `“${node.title}”用于判断的“${path}”从哪里获得？`,
          detail: "条件字段无法追溯到运行输入、变量或真实上游输出。",
        });
      }
    }
  }
  if (node.type === "human") {
    if (!node.approval?.role) {
      gaps.push({
        kind: "human_owner",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”由哪个真实角色或负责人做决定？`,
        detail: "人工节点没有负责人角色，运行时无法路由审批。",
      });
    }
    if (!node.approval?.reason) {
      gaps.push({
        kind: "human_decision",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”需要人工确认什么业务判断？`,
        detail: "人工节点没有明确决策内容。",
      });
    }
  }
  if (node.type === "wait") {
    const mode = node.wait?.mode || "event";
    if (mode === "event" && !node.wait?.eventKey && !node.wait?.spec?.eventKey) {
      gaps.push({
        kind: "wait_event",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”等待的真实事件如何识别？`,
        detail: "事件等待没有 eventKey，无法把外部事件和当前 Run 对应起来。",
      });
    }
    if (Number(node.wait?.timeoutMs || 0) > 0 && !node.wait?.onTimeoutNext && !node.onErrorNext && !node.next) {
      gaps.push({
        kind: "wait_timeout",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”超时以后应该怎么办？`,
        detail: "等待有超时时间但没有明确超时路径。",
      });
    }
  }
  if (node.type === "loop") {
    const path = node.loop?.collectionPath;
    if (!path) {
      gaps.push({
        kind: "loop_collection",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”逐项处理的真实数据集合是什么？`,
        detail: "Loop 没有 collectionPath。",
      });
    } else {
      const status = sourcePathStatus(path, workflow, intent, node);
      if (!status.known) {
        gaps.push({
          kind: "loop_source",
          nodeId: node.id,
          title: node.title,
          path,
          question: `“${node.title}”的集合“${path}”从哪里来？`,
          detail: "Loop 集合无法追溯到运行输入、变量或上游输出。",
        });
      }
    }
  }
  if (node.type === "agent_call") {
    if (!node.agentCall?.targetAgentId || !node.agentCall?.versionId) {
      gaps.push({
        kind: "agent_target",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”具体调用哪个已发布 Agent 版本？`,
        detail: "Agent Call 没有冻结目标 Agent/Version。",
      });
    }
    if (node.agentCall?.targetAgentId && !(node.agentCall?.inputContract?.fields || []).length) {
      gaps.push({
        kind: "agent_input_contract",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”要传给下游 Agent 哪些输入？`,
        detail: "目标 Agent 输入 Contract 未冻结。",
      });
    }
    if (node.agentCall?.targetAgentId && !(node.agentCall?.outputContract?.fields || []).length) {
      gaps.push({
        kind: "agent_output_contract",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”需要下游 Agent 返回什么？`,
        detail: "目标 Agent 输出 Contract 未冻结。",
      });
    }
  }
  if (node.type === "handoff") {
    if (!node.toAgent?.id) {
      gaps.push({
        kind: "handoff_target",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”实际交给谁？`,
        detail: "Handoff 没有真实接收 Agent/角色。",
      });
    }
    if (!(node.contract?.deliverables || []).length) {
      gaps.push({
        kind: "handoff_deliverables",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”必须交付哪些内容？`,
        detail: "Handoff 没有必交内容，无法验收交接是否完成。",
      });
    }
  }
  if (node.type === "subflow") {
    if (!node.subflow?.name) {
      gaps.push({
        kind: "subflow_contract",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”的子流程具体是什么？`,
        detail: "Subflow 没有明确名称/Contract。",
      });
    }
    if (!(node.subflow?.outputs || []).length && !node.subflow?.workflow?.outputContract?.fields?.length) {
      gaps.push({
        kind: "subflow_output",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”完成后返回什么业务结果？`,
        detail: "Subflow 没有声明返回主流程的业务输出。",
      });
    }
  }
  if (node.type === "parallel") {
    const branches = (node.parallel?.branches || []) as GroundingParallelBranch[];
    if (branches.length < 2) {
      gaps.push({
        kind: "parallel_contract",
        nodeId: node.id,
        title: node.title,
        question: `“${node.title}”到底有哪些可以并行的真实业务分支？`,
        detail: "Parallel 节点少于两个实际分支。",
      });
    }
    for (const branch of branches) {
      if (!(branch.steps || []).length) {
        gaps.push({
          kind: "parallel_branch_empty",
          nodeId: node.id,
          title: node.title,
          branchId: branch.id,
          question: `“${branch.label || node.title}”并行分支具体要执行什么？`,
          detail: "并行分支没有真实步骤。",
        });
      }
    }
  }
  return gaps;
}

export function analyzeBusinessExecutability(
  workflow: GroundingWorkflow | null,
  intent: GroundingIntent = {},
  answers: Record<string, unknown> = {},
): GroundingExecutability {
  const wf = workflow || {};
  const nodes = wf.nodes || {};
  const blockers: GroundingBlocker[] = [];
  for (const node of Object.values(nodes)) {
    if (!node?.businessSpec) continue;
    const sources = executionSources(wf, node, intent, answers);
    const gaps = nodeSourceGaps(wf, node, intent, answers);
    if (
      sources.some((x) => x.kind === "confirmed-runtime-input") &&
      !((node.businessSpec.inputs || []).some((x) => x.source === "confirmed-runtime-input"))
    ) {
      const confirmedSource = sources.find((x) => x.kind === "confirmed-runtime-input");
      node.businessSpec.inputs = [
        ...(node.businessSpec.inputs || []),
        { path: "input", label: confirmedSource?.label, source: "confirmed-runtime-input" },
      ];
    }
    node.businessSpec.executability = {
      status: gaps.length ? "blocked" : "executable",
      sources,
      missingSources: gaps,
      checkedAt: "design-time",
    };
    blockers.push(...gaps);
  }
  const businessNodes = Object.values(nodes).filter(
    (n) => n?.ui?.visibility !== "control" && !["trigger", "end"].includes(String(n?.type)),
  );
  const executable = businessNodes.filter((n) => n.businessSpec?.executability?.status === "executable").length;
  return {
    schema: "business-executability/v5.7",
    status: blockers.length ? "blocked" : "ready",
    businessNodeCount: businessNodes.length,
    executableNodeCount: executable,
    blockerCount: blockers.length,
    coveragePercent: businessNodes.length ? Math.round((executable / businessNodes.length) * 100) : 100,
    blockers,
    policy: "业务节点不仅要有需求证据，还必须有可追溯的数据/能力来源；读取、查询、条件判断不得依靠未声明的数据源。",
  };
}

export function businessExecutabilityAmbiguities(workflow: GroundingWorkflow | null): BusinessExecutabilityAmbiguity[] {
  return (workflow?.businessExecutability?.blockers || [])
    .slice(0, 3)
    .map((blocker, index) => ({
      id: `data_source_${blocker.nodeId || index}`,
      question: blocker.question,
      default: "",
      reason: blocker.detail || "没有真实数据来源时，该步骤无法可靠执行。",
      suggestions: ["由用户在运行时提供", "从上一步业务结果获得", "连接并绑定真实业务系统/知识库"],
    }));
}

function enrichUpstreamInputs(nodes: Record<string, GroundingNode>): void {
  for (const node of Object.values(nodes)) {
    if (!node.businessSpec || ["trigger", "end"].includes(String(node.type))) continue;
    const current = node.businessSpec.inputs || [];
    const known = new Set(current.map((x) => x.path));
    for (const pred of predecessorNodes(nodes, node.id)) {
      if (pred.ui?.visibility === "control") continue;
      for (const name of pred.businessSpec?.outputs || []) {
        const path = `context.outputs.${pred.id}`;
        if (!known.has(path)) {
          current.push({ path, label: `上一步“${pred.title}”产出的${name}`, source: "upstream-business-output" });
          known.add(path);
        }
      }
    }
    node.businessSpec.inputs = current.slice(0, 12);
  }
}

export function groundBusinessWorkflow(workflow: GroundingWorkflow, context: GroundingContext = {}): WorkflowDraft {
  const { sourceText = "", intent = {}, answers = {} } = context;
  const draft = structuredClone(workflow || {}) as GroundingWorkflow;
  const nodes = draft.nodes || {};
  const requirements = extractBusinessRequirements({ sourceText, intent, answers });
  const removed: Array<{ id?: string; title?: string; reason: string }> = [];
  for (const node of Object.values(nodes)) {
    const kind = controlPlaneKind(node, draft);
    if (kind) {
      node.controlPlane = {
        kind,
        hiddenByDefault: true,
        reason:
          kind === "quality"
            ? "Harness/Release Gate 自动执行，不属于业务步骤"
            : kind === "receipt"
              ? "用于验证真实系统回执，不属于用户业务动作"
              : "平台安全/恢复/交付控制节点",
      };
      node.ui = { ...(node.ui || {}), visibility: "control" };
      continue;
    }
    if (["trigger", "end"].includes(String(node.type))) {
      node.ui = { ...(node.ui || {}), visibility: "business" };
      node.businessSpec = {
        schema: "business-node-spec/v5.7",
        objective: clean(node.description || node.title, 220),
        inputs: [],
        rules: [],
        outputs: [],
        doneWhen: observableDoneWhen(node, [], []),
        evidence: [],
        assumptions: [],
        grounding: { status: "structural", score: 1, requirementIds: [], sourceSnippets: [], derivedFrom: "runtime-structure" },
      };
      continue;
    }
    const stepInfo = (intent?.orderedSteps || []).find((s) => s.id === node.id);
    if (stepInfo) {
      if (!node.intentEvidence && stepInfo.evidence) node.intentEvidence = { text: stepInfo.evidence };
      if (!node.description && stepInfo.title) node.description = stepInfo.title;
    }
    let matches = matchRequirements(node, requirements);
    const executionEvidence = executionContractEvidence(draft, node);
    if (
      !matches.length &&
      !GENERIC_TITLES.test(clean(node.title, 120)) &&
      (executionEvidence.length || node.operation?.kind || node.type === "ai" || node.type === "tool" || node.type === "knowledge" || node.type === "rule" || node.type === "human" || node.type === "agent_call")
    ) {
      const overarching = requirements.find((r) => r.source === "user" && ["action", "condition"].includes(r.type) && !isConversationalOrMeta(r.text));
      if (overarching) matches = [{ r: overarching, score: 0.78, derivedFrom: "business-contract" }];
    }
    const structuredOutputs = outputFieldsFor(node, draft);
    const existing: GroundingBusinessSpec = node.businessSpec && typeof node.businessSpec === "object" ? node.businessSpec : {};
    const evidence = unique([
      ...matches.map((x) => x.r.text),
      node.intentEvidence?.text && sourceText.includes(node.intentEvidence.text) ? node.intentEvidence.text : null,
    ])
      .filter((x) => x && !isConversationalOrMeta(x))
      .slice(0, 3);
    const best = matches[0]?.r;
    const objective = clean(existing.objective || best?.text || node.title || node.description, 220);
    const rules = unique([
      ...(Array.isArray(existing.rules) ? existing.rules : []),
      ...branchRules(node),
      node.type === "human" && node.approval?.reason ? node.approval.reason : null,
      node.type === "tool" && node.tool?.scope ? `只在已授权范围 ${node.tool.scope} 内执行` : null,
    ])
      .map((x) => clean(x, 220))
      .filter(Boolean)
      .slice(0, 10);
    const outputNames = unique([
      ...(Array.isArray(existing.outputs) ? existing.outputs.map((x) => (typeof x === "string" ? x : x?.label || x?.path)) : []),
      ...structuredOutputs.map((x) => x.label),
      ...nodeDerivedOutputs(node),
    ]).filter(Boolean);
    const doneWhen = unique([
      ...(Array.isArray(existing.doneWhen) ? existing.doneWhen : []),
      ...observableDoneWhen(node, structuredOutputs, outputNames),
    ])
      .map((x) => clean(x, 220))
      .filter(Boolean)
      .slice(0, 10);
    const groundingStatus = matches.length ? "grounded" : executionEvidence.length ? "execution-grounded" : "weak";
    const groundingScore = matches[0]?.score || (executionEvidence.length ? 0.78 : 0);
    node.businessSpec = {
      schema: "business-node-spec/v5.7",
      objective,
      inputs: nodeInputs(node),
      rules,
      outputs: outputNames,
      doneWhen,
      evidence,
      executionEvidence,
      assumptions: Array.isArray(existing.assumptions) ? existing.assumptions : [],
      grounding: {
        status: groundingStatus,
        score: groundingScore,
        requirementIds: matches.map((x) => x.r.id),
        sourceSnippets: evidence,
        executionSnippets: executionEvidence,
        derivedFrom: matches.length ? "business-requirements" : executionEvidence.length ? "execution-contract" : "runtime-structure",
      },
    };
    node.requirementIds = unique([...(node.requirementIds || []), ...matches.map((x) => x.r.id)]);
    node.ui = { ...(node.ui || {}), visibility: "business" };
  }
  for (const node of Object.values({ ...nodes })) {
    const matches = node.businessSpec?.grounding?.requirementIds || [];
    if (isGenericUngrounded(node, matches) && removeLinear(nodes, node.id as string)) {
      removed.push({ id: node.id, title: node.title, reason: "通用模板节点没有业务证据且可安全直连" });
    }
  }
  const collapsed = collapseDuplicates(nodes);
  enrichUpstreamInputs(nodes);
  const businessExecutability = analyzeBusinessExecutability(draft, intent, answers);
  draft.businessExecutability = businessExecutability;
  const visible = Object.values(nodes).filter((n) => n.ui?.visibility !== "control");
  const businessNodes = visible.filter((n) => !["trigger", "end"].includes(String(n.type)));
  const controlNodes = Object.values(nodes).filter((n) => n.ui?.visibility === "control");
  const weak = businessNodes.filter((n) => n.businessSpec?.grounding?.status === "weak");
  const covered = new Set(businessNodes.flatMap((n) => n.businessSpec?.grounding?.requirementIds || []));
  const explicit = requirements.filter((r) => r.explicit && ["action", "condition", "output"].includes(r.type) && !isConversationalOrMeta(r.text));
  const constraints = requirements.filter((r) => r.explicit && r.type === "constraint" && !isConversationalOrMeta(r.text));
  for (const requirement of explicit.filter((x) => x.type === "output")) {
    if (covered.has(requirement.id)) continue;
    const hasContractOutput = (draft.outputContract?.fields || []).length > 0;
    const hasDeliveryNode = Object.values(nodes).some(
      (n) => n.type === "system" && (n.system?.kind === "deliver_output" || n.id === "deliver_business_result" || CONTROL_IDS.test(String(n.id || ""))),
    );
    const lastBusinessNode = businessNodes[businessNodes.length - 1];
    if (hasContractOutput || hasDeliveryNode || (lastBusinessNode && (lastBusinessNode.businessSpec?.outputs || []).length > 0)) {
      covered.add(requirement.id);
      // 旧代码此处直接解引用 businessSpec.grounding.requirementIds 并 push；本模块内业务节点必带
      // grounding.requirementIds，缺失属不可达不变量，strict TS 下改为守卫跳过
      const lastGrounding = lastBusinessNode?.businessSpec?.grounding;
      if (lastBusinessNode && lastGrounding?.requirementIds && !lastGrounding.requirementIds.includes(requirement.id)) {
        lastGrounding.requirementIds.push(requirement.id);
      }
    }
  }
  const uncovered = explicit.filter((r) => !covered.has(r.id));
  const forbidden = normalizeForbiddenActions([
    ...(intent?.forbiddenActions || []),
    ...constraints.filter((r) => NEG_RE.test(r.text)).map((r) => r.text),
  ]);
  draft.businessRequirements = { schema: "business-requirements/v5.7", sourceText: clean(sourceText, 1200), items: requirements };
  draft.businessPolicies = {
    schema: "business-policy/v5.7",
    forbiddenActions: forbidden,
    constraints: constraints.map((r) => ({ id: r.id, text: r.text, source: r.source })),
  };
  draft.businessGrounding = {
    schema: "business-grounding/v5.7",
    businessNodeCount: businessNodes.length,
    controlNodeCount: controlNodes.length,
    removedTemplateNodes: removed,
    collapsedDuplicateNodes: collapsed,
    groundedNodeCount: businessNodes.filter((n) => n.businessSpec?.grounding?.status === "grounded").length,
    weakNodeIds: weak.map((n) => n.id),
    explicitRequirementCount: explicit.length,
    coveredExplicitRequirementCount: explicit.length - uncovered.length,
    uncoveredExplicitRequirements: uncovered,
    coveragePercent: explicit.length ? Math.round(((explicit.length - uncovered.length) / explicit.length) * 100) : 100,
    constraintCount: constraints.length,
    executability: {
      status: businessExecutability.status,
      coveragePercent: businessExecutability.coveragePercent,
      blockerCount: businessExecutability.blockerCount,
    },
    policy:
      "业务节点必须有需求证据；禁止/约束要求进入 Harness/Policy 而不是业务动作；平台控制节点默认隐藏；不为“显得完整”添加无来源业务步骤；读取/查询/判断节点必须能追溯到真实数据源",
  };
  // 仅校验不替换：Zod 解析会补默认值并剥离旧遗留字段，直接返回解析结果会破坏金测对齐（持久化方 Task 8/10 负责入库前 parse）
  WorkflowDraft.parse(draft);
  return draft as unknown as WorkflowDraft;
}

export function businessVisibleNodes(workflow: GroundingWorkflow | null): GroundingNode[] {
  return Object.values(workflow?.nodes || {}).filter((n) => n?.ui?.visibility !== "control" && !n?.controlPlane?.hiddenByDefault);
}
