import { createHash, randomUUID } from "node:crypto";
import { isConversationalOrMeta } from "@/server/domain/intent";
import { forbiddenActionMatch, type PolicyNode } from "@/server/domain/grounding/business-policy";
import { safeDataPathSegments } from "@/server/domain/runtime/data-path";
import { canProduceQualityResult } from "@/server/domain/runtime/quality-checks";

// 旧系统 server/designAuditor.mjs 的逐行移植（设计审计 auditWorkflow，minified 展开为可读 TS）。
// 移植边界按引用可达性逐个核实：旧版 proposeAuditFixes 不直接移植，仅保留检查逻辑；
// 新系统的白名单安全修复在 safe-audit-fixes.ts，避免伪造业务证据、工具或协作目标。
// clone(:165)/uniq(:609)/firstEnd(:165,583,599)/breakCycleEdge(:386,592)/insertBefore(:170,344,404,488)/
// defaultSchema(:204,205) 一并跳过；safeStr(:7)/hasPathToHuman(:29) 全文件零引用（死代码）不移植。
// coverageFor 仅被 proposeAuditFixes 引用（旧 :259/:293/:543），auditWorkflow 只读
// requirementContract.coverage.uncovered，故不引入（简报 Consumes 行偏差）。
// 不做入参 WorkflowDraft.parse：审计自身必须容忍缺 startNodeId/memoryPolicy 等残缺草稿并如实报
// issue（这正是 auditWorkflow 的产出），入参 parse 会让残缺输入直接抛错、改变旧系统行为，
// 故按控制方裁定 4 的"如需"条件选择不 parse，处理原始结构。

export interface AuditIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  detail: string;
  nodeId: string | null;
  fixable: boolean;
  code: string;
}

export interface DesignAuditResult {
  id: string;
  score: number;
  status: "blocked" | "review" | "ready";
  counts: { critical: number; warning: number; info: number };
  issues: AuditIssue[];
  categoryStatus: Array<{ category: string; status: "blocked" | "review" | "good"; issues: number }>;
  nodeCount: number;
  edgeCount: number;
  requirementCoverage: unknown;
  complexityProfile: unknown;
  checkedAt: string;
  schema: string;
}

export interface AuditTool {
  [key: string]: unknown;
  scope?: string | null;
  action?: string | null;
  risk?: string | null;
  maxRetries?: number | null;
  registryToolId?: string | null;
  protocol?: string | null;
  unresolved?: boolean | null;
}

export interface AuditConditionBranch {
  [key: string]: unknown;
  label?: unknown;
  value?: unknown;
  next?: string | null;
  rules?: Array<{ [key: string]: unknown; source?: string | null; operator?: string | null }>;
}

export interface AuditCondition {
  [key: string]: unknown;
  source?: string | null;
  operator?: string;
  branches?: AuditConditionBranch[];
  defaultNext?: string | null;
}

export interface AuditLoop {
  [key: string]: unknown;
  maxIterations?: number | null;
  bodyNext?: string | null;
  exitNext?: string | null;
}

export interface AuditWait {
  [key: string]: unknown;
  mode?: string | null;
  eventKey?: string | null;
  timeoutMs?: number | null;
  onTimeoutNext?: string | null;
}

export interface AuditSubflowStep {
  [key: string]: unknown;
  id?: string | null;
  type?: string | null;
  title?: string | null;
  tool?: AuditTool | null;
  knowledge?: { space?: string | null; [key: string]: unknown } | null;
  memory?: { mode?: string | null; [key: string]: unknown } | null;
  agentCall?: AuditAgentCall | null;
  toAgent?: { id?: string | null; versionId?: string | null; [key: string]: unknown } | null;
  contract?: AuditContract | null;
  subflow?: { name?: string | null; workflow?: AuditWorkflow | null; [key: string]: unknown } | null;
}

export interface AuditParallelBranch {
  [key: string]: unknown;
  id?: unknown;
  label?: unknown;
  steps?: unknown;
}

export interface AuditParallel {
  [key: string]: unknown;
  strategy?: string | null;
  branches?: unknown;
}

export interface AuditAgentCall {
  [key: string]: unknown;
  targetAgentId?: string | null;
  workflowId?: string | null;
  versionId?: string | null;
  memoryAccess?: { mode?: string | null; [key: string]: unknown } | null;
  inputContract?: { fields?: unknown; [key: string]: unknown } | null;
  outputContract?: { fields?: unknown; [key: string]: unknown } | null;
}

export interface AuditContract {
  [key: string]: unknown;
  deliverables?: unknown;
  mustNotInclude?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  memoryPolicy?: unknown;
}

export interface AuditSpec {
  [key: string]: unknown;
  grounding?: { status?: string | null; score?: number | null; [key: string]: unknown } | null;
  doneWhen?: unknown;
  evidence?: unknown;
}

export interface AuditNode {
  [key: string]: unknown;
  id?: string;
  title?: string | null;
  type?: string | null;
  description?: string | null;
  next?: string | null;
  rejectNext?: string | null;
  onErrorNext?: string | null;
  tool?: AuditTool | null;
  condition?: AuditCondition | null;
  loop?: AuditLoop | null;
  wait?: AuditWait | null;
  knowledge?: { space?: string | null; [key: string]: unknown } | null;
  memory?: { mode?: string | null; [key: string]: unknown } | null;
  parallel?: AuditParallel | null;
  subflow?: {
    name?: string | null;
    steps?: unknown;
    outputs?: unknown;
    workflow?: AuditWorkflow | null;
    [key: string]: unknown;
  } | null;
  agentCall?: AuditAgentCall | null;
  toAgent?: { id?: string | null; [key: string]: unknown } | null;
  contract?: AuditContract | null;
  system?: { kind?: string | null; [key: string]: unknown } | null;
  rule?: { kind?: string | null; sourceNodeId?: string | null; [key: string]: unknown } | null;
  quality?: { requiredOutputTitles?: unknown; minOutputCount?: unknown; [key: string]: unknown } | null;
  controlPlane?: { hiddenByDefault?: boolean | null; [key: string]: unknown } | null;
  ui?: { visibility?: string | null; [key: string]: unknown } | null;
  businessSpec?: AuditSpec | null;
}

export interface AuditVariable {
  [key: string]: unknown;
  name?: unknown;
  type?: unknown;
  scope?: unknown;
}

export interface AuditMemoryPolicy {
  [key: string]: unknown;
  shared?: unknown[];
  prohibited?: unknown[];
}

export interface AuditWorkflow {
  [key: string]: unknown;
  startNodeId?: string | null;
  nodes?: Record<string, AuditNode> | null;
  rootAgent?: { id?: string | null; [key: string]: unknown } | null;
  team?: { agents?: unknown; memoryPolicy?: AuditMemoryPolicy | null; [key: string]: unknown } | null;
  memoryPolicy?: AuditMemoryPolicy | null;
  variables?: unknown;
  outputContract?: { fields?: unknown; [key: string]: unknown } | null;
  businessPolicies?: { forbiddenActions?: string[]; [key: string]: unknown } | null;
  requirementContract?: {
    coverage?: { uncovered?: unknown; [key: string]: unknown } | null;
    [key: string]: unknown;
  } | null;
  businessGrounding?: {
    coveragePercent?: unknown;
    uncoveredExplicitRequirements?: unknown;
    [key: string]: unknown;
  } | null;
  businessExecutability?: { blockerCount?: unknown; blockers?: unknown; [key: string]: unknown } | null;
  complexityProfile?: unknown;
}

export interface AuditBlueprint {
  [key: string]: unknown;
  businessArchitecture?: { humanResponsibilities?: unknown[]; dataDependencies?: unknown[]; [key: string]: unknown } | null;
}

interface AuditEdge {
  from: string;
  to: string;
  kind: string;
  label: string;
}

interface IssueOptions {
  nodeId?: string | null;
  fixable?: boolean;
  code?: string | null;
}

function issue(
  severity: AuditIssue["severity"],
  category: string,
  title: string,
  detail: string,
  { nodeId = null, fixable = false, code = null }: IssueOptions = {},
): AuditIssue {
  const stableCode = code || `${category}:${title}`;
  const key = [severity, category, stableCode, nodeId || "workflow", title, detail].join("|");
  const id = `AUD-${createHash("sha1").update(key).digest("hex").slice(0, 10)}`;
  return { id, severity, category, title, detail, nodeId, fixable, code: stableCode };
}

function edgeList(wf: AuditWorkflow): AuditEdge[] {
  const nodes = wf?.nodes || {};
  const edges: AuditEdge[] = [];
  for (const n of Object.values(nodes)) {
    const from = n.id as string;
    if (n.next && nodes[n.next]) edges.push({ from, to: n.next, kind: "next", label: "下一步" });
    if (n.rejectNext && nodes[n.rejectNext]) edges.push({ from, to: n.rejectNext, kind: "reject", label: "不推进" });
    if (n.onErrorNext && nodes[n.onErrorNext]) edges.push({ from, to: n.onErrorNext, kind: "failure", label: "未完成时" });
    if (n.type === "condition") {
      for (const b of n.condition?.branches || []) {
        if (b.next && nodes[b.next]) edges.push({ from, to: b.next, kind: "condition", label: (b.label as string) || String(b.value ?? "分支") });
      }
      if (n.condition?.defaultNext && nodes[n.condition.defaultNext]) {
        edges.push({ from, to: n.condition.defaultNext, kind: "condition-default", label: "否则" });
      }
    }
    if (n.type === "loop") {
      if (n.loop?.bodyNext && nodes[n.loop.bodyNext]) edges.push({ from, to: n.loop.bodyNext, kind: "loop-body", label: "继续处理" });
      if (n.loop?.exitNext && nodes[n.loop.exitNext]) edges.push({ from, to: n.loop.exitNext, kind: "loop-exit", label: "循环结束" });
    }
    if (n.type === "wait" && n.wait?.onTimeoutNext && nodes[n.wait.onTimeoutNext]) {
      edges.push({ from, to: n.wait.onTimeoutNext, kind: "wait-timeout", label: "等待超时" });
    }
  }
  return edges;
}

function reachable(wf: AuditWorkflow): Set<string> {
  const seen = new Set<string>();
  const edges = edgeList(wf);
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const bucket = out.get(e.from);
    if (bucket) bucket.push(e.to);
    else out.set(e.from, [e.to]);
  }
  const stack = [wf?.startNodeId].filter(Boolean) as string[];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const to of out.get(id) || []) stack.push(to);
  }
  return seen;
}

function predecessors(wf: AuditWorkflow, id: string): AuditEdge[] {
  return edgeList(wf).filter((e) => e.to === id);
}

function successors(wf: AuditWorkflow, id: string): AuditEdge[] {
  return edgeList(wf).filter((e) => e.from === id);
}

function hasPathToHumanReverse(wf: AuditWorkflow, id: string, max = 8): boolean {
  const nodes = wf?.nodes || {};
  const seen = new Set<string>();
  const q: Array<[string, number]> = [[id, 0]];
  while (q.length) {
    const [cur, d] = q.shift() as [string, number];
    if (seen.has(cur) || d > max) continue;
    seen.add(cur);
    for (const e of predecessors(wf, cur)) {
      const n = nodes[e.from];
      if (n?.type === "human") return true;
      q.push([e.from, d + 1]);
    }
  }
  return false;
}

function fieldSchemaOk(list: unknown): boolean {
  const rows = list as Array<{ name?: unknown; type?: unknown }> | null | undefined;
  return (
    Array.isArray(rows) &&
    rows.length > 0 &&
    rows.every((x) => x && typeof x.name === "string" && x.name.trim() && ["string", "number", "boolean", "object", "array", "any"].includes((x.type as string) || "any"))
  );
}

function highImpactScope(scope: string | null = ""): boolean {
  return /send|delete|pay|payment|publish|write|offer|salary|admin/i.test(String(scope));
}

const CONDITION_OPERATORS = new Set(["eq", "neq", "contains", "gt", "gte", "lt", "lte", "truthy", "exists"]);

function conditionSourceOk(source: string | null | undefined): boolean {
  const parts = source ? safeDataPathSegments(source) : null;
  return Boolean(parts && ["input", "variables", "context"].includes(parts[0]));
}

type RuntimeInputType = "string" | "number" | "boolean" | "object" | "array";
const ALL_RUNTIME_INPUT_TYPES: readonly RuntimeInputType[] = ["string", "number", "boolean", "object", "array"];

function inputRequirement(
  source: string | null | undefined,
  operator?: string | null,
  comparison?: unknown,
): { name: string; types: readonly RuntimeInputType[] } | null {
  const parts = source ? safeDataPathSegments(source) : null;
  if (!parts || !["input", "variables"].includes(parts[0]) || !parts[1]) return null;
  if (parts.length > 2) return { name: parts[1], types: ["object"] };
  if (["truthy", "exists"].includes(operator || "")) return null;
  if (operator === "contains") return { name: parts[1], types: ["string", "array"] };
  if (["gt", "gte", "lt", "lte"].includes(operator || "") || typeof comparison === "number") {
    return { name: parts[1], types: ["number"] };
  }
  if (typeof comparison === "boolean") return { name: parts[1], types: ["boolean"] };
  if (typeof comparison === "string") return { name: parts[1], types: ["string"] };
  if (Array.isArray(comparison)) return { name: parts[1], types: ["array"] };
  if (comparison !== null && typeof comparison === "object") return { name: parts[1], types: ["object"] };
  return null;
}

const SUPPORTED_INLINE_TYPES = new Set(["ai", "tool", "knowledge", "system", "memory", "agent_call", "handoff"]);

function inlineRuntimeSettingIssue(step: AuditSubflowStep): { category: string; title: string; detail: string } | null {
  if (!step.type || !SUPPORTED_INLINE_TYPES.has(step.type)) {
    return { category: "logic", title: "内部步骤类型无法执行", detail: `步骤类型「${step.type || "未设置"}」不能在这里自动执行。` };
  }
  if (step.type === "tool" && (!step.tool || step.tool.unresolved === true || (!step.tool.registryToolId && step.tool.protocol !== "demo"))) {
    return { category: "permission", title: "内部工具尚未绑定可执行能力", detail: "没有绑定演示工具或服务端注册工具。" };
  }
  if (step.type === "knowledge" && !step.knowledge?.space?.trim()) {
    return { category: "data", title: "内部资料步骤没有资料范围", detail: "没有选择可查询的资料范围。" };
  }
  if (step.type === "memory" && !step.memory?.mode) {
    return { category: "memory", title: "内部经验步骤设置不完整", detail: "没有选择读取或保存经验。" };
  }
  if (step.type === "agent_call" && (!step.agentCall?.targetAgentId || !step.agentCall.versionId)) {
    return { category: "handoff", title: "内部协作步骤没有可调用助手", detail: "没有选择已发布的协作助手。" };
  }
  if (step.type === "handoff") {
    const contract = step.contract;
    if (
      !step.toAgent?.id ||
      !step.toAgent.versionId ||
      !Array.isArray(contract?.deliverables) ||
      !contract.deliverables.length ||
      !Array.isArray(contract.mustNotInclude) ||
      !contract.mustNotInclude.length ||
      !fieldSchemaOk(contract.inputSchema) ||
      !fieldSchemaOk(contract.outputSchema) ||
      !contract.memoryPolicy
    ) {
      return { category: "handoff", title: "内部交接契约不完整", detail: "接收助手、必交内容、禁止内容、输入输出结构或经验边界尚未完整设置。" };
    }
  }
  return null;
}

function memoryPolicy(wf: AuditWorkflow): AuditMemoryPolicy | null {
  return wf?.team?.memoryPolicy || wf?.memoryPolicy || null;
}

function cycleIssues(wf: AuditWorkflow): string[][] {
  const nodes = wf?.nodes || {};
  const edges = edgeList(wf);
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const bucket = adj.get(e.from);
    if (bucket) bucket.push(e.to);
    else adj.set(e.from, [e.to]);
  }
  const state = new Map<string, number>();
  const stack: string[] = [];
  const found: string[][] = [];
  function dfs(id: string): void {
    state.set(id, 1);
    stack.push(id);
    for (const to of adj.get(id) || []) {
      if (state.get(to) === 1) {
        const idx = stack.lastIndexOf(to);
        const cyc = stack.slice(idx).concat(to);
        const cycleEdges = cyc.slice(0, -1).map((from, index) =>
          edges.filter((edge) => edge.from === from && edge.to === cyc[index + 1]));
        const allowed = cycleEdges.some((matches, index) =>
          nodes[cyc[index]]?.type === "loop" && matches.some((edge) => edge.kind === "loop-body"))
          && !cycleEdges.some((matches, index) =>
            nodes[cyc[index]]?.type === "loop" && matches.some((edge) => edge.kind === "loop-exit"));
        if (!allowed) found.push(cyc);
      } else if (!state.get(to)) {
        dfs(to);
      }
    }
    stack.pop();
    state.set(id, 2);
  }
  if (wf?.startNodeId) dfs(wf.startNodeId);
  return found;
}

function hasTypeRecursive(wf: AuditWorkflow | null | undefined, types: Set<string> | string | string[]): boolean {
  const wanted = types instanceof Set ? types : new Set(Array.isArray(types) ? types : [types]);
  const pending = wf ? [wf] : [];
  const visited = new Set<AuditWorkflow>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const n of Object.values(current.nodes || {})) {
      if (wanted.has(n?.type ?? "")) return true;
      if (n?.type === "subflow" && n.subflow?.workflow) pending.push(n.subflow.workflow);
      const children =
        n?.type === "parallel"
          ? ((n.parallel?.branches as AuditParallelBranch[] | undefined) || []).flatMap((branch) => (branch.steps as AuditSubflowStep[] | undefined) || [])
          : n?.type === "subflow" && Array.isArray(n.subflow?.steps)
            ? (n.subflow.steps as AuditSubflowStep[])
            : [];
      for (const step of children) {
        if (wanted.has(step?.type ?? "")) return true;
        if (step?.type === "subflow" && step.subflow?.workflow) pending.push(step.subflow.workflow);
      }
    }
  }
  return false;
}

export function auditWorkflow(workflow: AuditWorkflow, blueprint: AuditBlueprint = {}): DesignAuditResult {
  const wf: AuditWorkflow = workflow || {};
  const nodes: Record<string, AuditNode> = wf.nodes || {};
  const issues: AuditIssue[] = [];
  const ids = Object.keys(nodes);
  const reach = reachable(wf);
  const edges = edgeList(wf);

  if (!wf.startNodeId || !nodes[wf.startNodeId]) {
    issues.push(issue("critical", "flow", "缺少有效启动节点", "流程无法确定从哪里开始。", { fixable: true, code: "start_missing" }));
  }
  const endIds = ids.filter((id) => nodes[id]?.type === "end");
  if (!endIds.length) {
    issues.push(issue("critical", "flow", "没有完成节点", "流程没有明确的业务闭环终点。", { fixable: true, code: "end_missing" }));
  }
  const outputFields = (wf.outputContract?.fields as unknown[] | undefined) || [];
  if (!outputFields.length) {
    issues.push(
      issue("critical", "data", "没有定义最终交付物", "流程只说明了怎么执行，却没有说明最终要交给员工什么结果；不能据此判定任务完成。", { fixable: true, code: "output_contract_missing" }),
    );
  }
  if (outputFields.length) {
    for (const endId of endIds) {
      const incoming = predecessors(wf, endId);
      const hasDelivery = incoming.some((edge) => nodes[edge.from]?.type === "system" && nodes[edge.from]?.system?.kind === "deliver_output");
      if (!hasDelivery) {
        issues.push(
          issue("critical", "data", "结束前没有形成业务结果", `「${nodes[endId]?.title || "完成"}」路径会直接结束，没有先整理画布要求的最终交付物。`, {
            nodeId: endId,
            fixable: true,
            code: "end_without_delivery",
          }),
        );
      }
    }
  }

  for (const id of ids) {
    const n = nodes[id];
    if (!reach.has(id)) {
      issues.push(issue("warning", "flow", "存在无法到达的步骤", `「${n.title}」当前没有从启动节点可达的路径。`, { nodeId: id, fixable: true, code: "unreachable" }));
    }
    const outs = successors(wf, id);
    if (n.type !== "end" && !outs.length && n.type !== "subflow") {
      issues.push(issue("critical", "flow", "流程出现死路", `「${n.title}」执行后没有下一步。`, { nodeId: id, fixable: true, code: "dead_end" }));
    }

    if (n.type === "tool") {
      if (!n.tool || n.tool.unresolved === true || (!n.tool.registryToolId && n.tool.protocol !== "demo")) {
        issues.push(issue("critical", "permission", "工具尚未绑定可执行能力", `「${n.title}」没有绑定演示工具或服务端注册工具。`, { nodeId: id, fixable: true, code: "tool_binding" }));
      }
      if (!n.tool?.scope) {
        issues.push(issue("critical", "permission", "工具缺少权限范围", `「${n.title}」没有声明 scope，无法进入受控运行。`, { nodeId: id, fixable: true, code: "tool_scope" }));
      }
      if (highImpactScope(n.tool?.scope) && !hasPathToHumanReverse(wf, id)) {
        issues.push(issue("critical", "permission", "高影响动作缺少人工门禁", `「${n.title}」属于高影响工具动作，但上游没有明确人工批准。`, { nodeId: id, fixable: true, code: "high_impact_no_human" }));
      }
      if (Number(n.tool?.maxRetries || 0) < 1) {
        issues.push(issue("warning", "recovery", "工具失败没有恢复策略", `「${n.title}」未配置重试或故障 Checkpoint。`, { nodeId: id, fixable: true, code: "tool_recovery" }));
      }
    }

    if (n.type === "knowledge" && !n.knowledge?.space?.trim()) {
      issues.push(issue("critical", "data", "读取资料步骤没有资料范围", `「${n.title}」没有选择可查询的资料范围。`, { nodeId: id, fixable: true, code: "knowledge_space" }));
    }

    if (n.type === "memory" && !n.memory?.mode) {
      issues.push(issue("critical", "memory", "经验步骤设置不完整", `「${n.title}」没有选择读取或保存经验，无法执行。`, { nodeId: id, fixable: true, code: "memory_mode" }));
    }

    if (n.type === "rule") {
      const kind = n.rule?.kind;
      if (["tool_result", "tool_receipt"].includes(kind || "")) {
        const source = n.rule?.sourceNodeId ? nodes[n.rule.sourceNodeId] : null;
        if (!source || source.type !== "tool") {
          issues.push(issue("critical", "logic", "系统回执检查缺少工具来源", `「${n.title}」没有选择要核对的工具步骤。`, { nodeId: id, fixable: true, code: "rule_tool_source" }));
        }
      } else if (kind !== "business_rule" && !n.quality) {
        issues.push(issue("critical", "logic", "检查步骤设置不完整", `「${n.title}」没有可执行的业务判断、系统回执或交付检查设置。`, { nodeId: id, fixable: true, code: "rule_spec" }));
      }
      if (n.quality && Array.isArray(n.quality.requiredOutputTitles)) {
        const requiredTitles = [...new Set(n.quality.requiredOutputTitles.map(String))];
        for (const title of requiredTitles) {
          const matches = Object.values(nodes).filter((candidate) => candidate.title === title);
          if (matches.length === 0) {
            issues.push(issue("critical", "logic", "交付检查引用的步骤不存在", `「${n.title}」要求检查「${title}」，但画布中没有这个步骤。`, { nodeId: id, fixable: true, code: `quality_source_missing_${title}` }));
          } else if (matches.length > 1) {
            issues.push(issue("critical", "logic", "交付检查引用的步骤名称重复", `「${n.title}」要求检查「${title}」，但有多个步骤使用这个名称，无法确定检查对象。`, { nodeId: id, fixable: true, code: `quality_source_ambiguous_${title}` }));
          } else if (!canProduceQualityResult(matches[0].type)) {
            issues.push(issue("critical", "logic", "交付检查引用的步骤没有结果", `「${n.title}」要求检查「${title}」，但这个步骤不会产生可检查的交付结果。`, { nodeId: id, fixable: true, code: `quality_source_no_result_${title}` }));
          }
        }
        const minOutputCount = Number(n.quality.minOutputCount);
        if (requiredTitles.length > 0 && Number.isInteger(minOutputCount) && minOutputCount > requiredTitles.length) {
          issues.push(issue("critical", "logic", "交付检查的结果数量无法满足", `「${n.title}」要求至少 ${minOutputCount} 项结果，但只指定了 ${requiredTitles.length} 个结果来源。`, { nodeId: id, fixable: true, code: "quality_min_output_impossible" }));
        }
      }
    }

    if (n.type === "condition") {
      const bs = n.condition?.branches || [];
      if (bs.length < 1) {
        issues.push(issue("critical", "logic", "条件节点没有分支", `「${n.title}」没有配置条件结果。`, { nodeId: id, fixable: true, code: "condition_empty" }));
      }
      if (!n.condition?.source?.trim() && bs.some((branch) => !branch.rules?.length)) {
        issues.push(issue("critical", "data", "条件节点没有取值来源", `「${n.title}」包含直接比较分支，但没有选择要判断的数据。`, { nodeId: id, fixable: true, code: "condition_source" }));
      }
      if (n.condition?.source?.trim() && !conditionSourceOk(n.condition.source)) {
        issues.push(issue("critical", "data", "条件取值来源无法读取", `「${n.title}」的判断数据必须来自运行输入、上游结果或当前循环项。`, { nodeId: id, fixable: true, code: "condition_source_invalid" }));
      }
      if (bs.some((branch) => !branch.rules?.length) && !CONDITION_OPERATORS.has(n.condition?.operator || "")) {
        issues.push(issue("critical", "logic", "条件判断方式无法执行", `「${n.title}」使用了系统无法识别的判断方式。`, { nodeId: id, fixable: true, code: "condition_operator" }));
      }
      for (const [branchIndex, branch] of bs.entries()) {
        if (!branch.next) {
          issues.push(issue("critical", "flow", "条件结果没有后续步骤", `「${n.title}」的第 ${branchIndex + 1} 个结果没有连接后续步骤。`, { nodeId: id, fixable: true, code: `condition_target_${branchIndex}` }));
        }
        for (const [ruleIndex, rule] of (branch.rules || []).entries()) {
          if (!conditionSourceOk(rule.source)) {
            issues.push(issue("critical", "data", "组合条件取值来源无法读取", `「${n.title}」第 ${branchIndex + 1} 个结果的第 ${ruleIndex + 1} 条条件没有有效数据来源。`, { nodeId: id, fixable: true, code: `condition_rule_source_${branchIndex}_${ruleIndex}` }));
          }
          if (!CONDITION_OPERATORS.has(rule.operator || "")) {
            issues.push(issue("critical", "logic", "组合条件判断方式无法执行", `「${n.title}」第 ${branchIndex + 1} 个结果的第 ${ruleIndex + 1} 条条件使用了未知判断方式。`, { nodeId: id, fixable: true, code: `condition_rule_operator_${branchIndex}_${ruleIndex}` }));
          }
        }
      }
      const targets = bs.map((b) => b.next).filter(Boolean);
      if (new Set(targets).size !== targets.length) {
        issues.push(issue("warning", "logic", "多个条件落到同一路径", `「${n.title}」的多个条件结果指向相同节点，可能存在冗余。`, { nodeId: id, fixable: true, code: "condition_duplicate" }));
      }
      if (!n.condition?.defaultNext) {
        issues.push(issue("warning", "logic", "条件缺少兜底路径", `「${n.title}」没有“否则/未命中”路径。`, { nodeId: id, fixable: true, code: "condition_default" }));
      }
    }

    if (n.type === "loop") {
      const max = Number(n.loop?.maxIterations || 0);
      if (!n.loop?.bodyNext || !n.loop?.exitNext) {
        issues.push(issue("critical", "logic", "循环结构不完整", `「${n.title}」必须同时声明循环体和退出路径。`, { nodeId: id, fixable: true, code: "loop_edges" }));
      }
      if (max < 1 || max > 100) {
        issues.push(issue("critical", "recovery", "循环缺少安全上限", `「${n.title}」最大循环次数应为 1–100。`, { nodeId: id, fixable: true, code: "loop_limit" }));
      }
      const collectionPath = typeof n.loop?.collectionPath === "string" ? n.loop.collectionPath : "";
      if (!conditionSourceOk(collectionPath)) {
        issues.push(issue("critical", "data", "逐项处理没有有效列表来源", `「${n.title}」必须从运行输入、上游结果或当前循环项读取列表。`, { nodeId: id, fixable: true, code: "loop_collection" }));
      }
    }

    if (n.onErrorNext && !nodes[n.onErrorNext]) {
      issues.push(issue("critical", "recovery", "失败备用路径没有连接有效步骤", `「${n.title}」失败后要去的步骤不存在。`, { nodeId: id, fixable: true, code: "failure_target" }));
    }

    if (n.type === "parallel") {
      const branches = (n.parallel?.branches as AuditParallelBranch[] | undefined) || [];
      if (branches.length < 2) {
        issues.push(issue("critical", "logic", "同时处理的工作不足两项", `「${n.title}」至少要包含两项独立工作，才是真正的并行步骤。`, { nodeId: id, fixable: true, code: "parallel_branches" }));
      }
      const branchIds = new Set<unknown>();
      for (const [index, branch] of branches.entries()) {
        if (!branch.id || branchIds.has(branch.id)) {
          issues.push(issue("critical", "logic", "并行工作缺少唯一标识", `「${n.title}」中的第 ${index + 1} 项工作没有唯一标识。`, { nodeId: id, fixable: true, code: `parallel_id_${index}` }));
        }
        branchIds.add(branch.id);
        const branchSteps = (branch.steps || []) as AuditSubflowStep[];
        if (!branchSteps.length) {
          issues.push(issue("critical", "logic", "并行工作没有实际步骤", `「${branch.label || `并行工作 ${index + 1}`}」里面没有可执行步骤。`, { nodeId: id, fixable: true, code: `parallel_empty_${index}` }));
        }
        let seenHuman = false;
        const stepIds = new Set<string>();
        for (const [stepIndex, step] of branchSteps.entries()) {
          if (step.id && stepIds.has(step.id)) {
            issues.push(issue("critical", "logic", "并行工作存在重复步骤标识", `「${branch.label || n.title}」里的第 ${stepIndex + 1} 个步骤与前面步骤使用了相同标识。`, {
              nodeId: id,
              fixable: true,
              code: `parallel_step_id_${index}_${stepIndex}`,
            }));
          }
          if (step.id) stepIds.add(step.id);
          const runtimeIssue = inlineRuntimeSettingIssue(step);
          if (runtimeIssue) {
            issues.push(issue("critical", runtimeIssue.category, runtimeIssue.title, `「${branch.label || n.title}」里的「${step.title || `步骤 ${stepIndex + 1}`}」${runtimeIssue.detail}`, {
              nodeId: id,
              fixable: true,
              code: `parallel_runtime_${index}_${stepIndex}`,
            }));
          }
          if (step.type === "human") seenHuman = true;
          if (step.type === "tool") {
            if (!step.tool?.scope) {
              issues.push(
                issue("critical", "permission", "并行工作中的工具缺少权限范围", `「${branch.label || n.title}」里的「${step.title || "系统操作"}」没有声明运行范围。`, {
                  nodeId: id,
                  fixable: true,
                  code: `parallel_tool_scope_${index}_${stepIndex}`,
                }),
              );
            }
            if (highImpactScope(step.tool?.scope) && !seenHuman && !hasPathToHumanReverse(wf, id)) {
              issues.push(
                issue("critical", "permission", "并行工作中的高影响动作缺少人工确认", `「${branch.label || n.title}」里的「${step.title || step.tool?.scope}」前没有员工确认。`, {
                  nodeId: id,
                  fixable: true,
                  code: `parallel_tool_human_${index}_${stepIndex}`,
                }),
              );
            }
          }
        }
      }
    }

    if (n.type === "wait") {
      const mode = n.wait?.mode || "event";
      if (!["delay", "until", "event"].includes(mode)) {
        issues.push(issue("critical", "logic", "等待方式无法识别", `「${n.title}」需要选择等待一段时间、等到某时刻或等待外部消息。`, { nodeId: id, fixable: true, code: "wait_mode" }));
      }
      if (mode === "event" && !n.wait?.eventKey) {
        issues.push(issue("critical", "data", "等待消息缺少匹配标识", `「${n.title}」无法判断哪条外部消息属于当前任务。`, { nodeId: id, fixable: true, code: "wait_event_key" }));
      }
      if (Number(n.wait?.timeoutMs || 0) > 0 && !n.wait?.onTimeoutNext && !n.onErrorNext) {
        issues.push(issue("warning", "recovery", "等待超时后没有处理方式", `「${n.title}」超时后会停止，建议连接提醒员工、备用处理或安全结束路径。`, { nodeId: id, fixable: true, code: "wait_timeout_route" }));
      }
    }

    if (n.type === "subflow") {
      const sf = n.subflow;
      const inlineSteps = Array.isArray(sf?.steps) ? (sf.steps as AuditSubflowStep[]) : [];
      const nested = sf?.workflow;
      if (!sf?.name || (!inlineSteps.length && !nested?.nodes)) {
        issues.push(issue("critical", "logic", "子流程说明不完整", `「${n.title}」缺少可执行的子流程步骤。`, { nodeId: id, fixable: true, code: "subflow_spec" }));
      }
      if (!Array.isArray(sf?.outputs) || !sf.outputs.length) {
        issues.push(issue("warning", "data", "子流程没有声明输出", `「${n.title}」无法说明返回主流程的业务结果。`, { nodeId: id, fixable: true, code: "subflow_output" }));
      }
      let seenHuman = false;
      const inlineStepIds = new Set<string>();
      for (const [i, step] of inlineSteps.entries()) {
        if (step.id && inlineStepIds.has(step.id)) {
          issues.push(issue("critical", "logic", "步骤组存在重复步骤标识", `「${n.title}」内部第 ${i + 1} 步与前面步骤使用了相同标识。`, {
            nodeId: id,
            fixable: true,
            code: `child_step_id_${i}`,
          }));
        }
        if (step.id) inlineStepIds.add(step.id);
        const runtimeIssue = inlineRuntimeSettingIssue(step);
        if (runtimeIssue) {
          issues.push(issue("critical", runtimeIssue.category, runtimeIssue.title, `「${n.title}」内部第 ${i + 1} 步「${step.title || "未命名步骤"}」${runtimeIssue.detail}`, {
            nodeId: id,
            fixable: true,
            code: `child_runtime_${i}`,
          }));
        }
        if (step?.type === "human") seenHuman = true;
        if (step?.type === "tool") {
          if (!step.tool?.scope) {
            issues.push(issue("critical", "permission", "Child Workflow 工具缺少权限范围", `「${n.title}」内部步骤 ${i + 1}「${step.title || "工具"}」没有声明 scope。`, { nodeId: id, fixable: true, code: `child_tool_scope_${i}` }));
          }
          if (highImpactScope(step.tool?.scope) && !seenHuman) {
            issues.push(issue("critical", "permission", "Child Workflow 高影响动作缺少人工门禁", `「${n.title}」内部高影响工具「${step.title || step.tool?.scope}」前没有人工确认。`, { nodeId: id, fixable: true, code: `child_tool_human_${i}` }));
          }
        }
        if (step?.type === "subflow" && !step.subflow?.name) {
          issues.push(issue("warning", "logic", "嵌套子流程缺少名称", `「${n.title}」内部第 ${i + 1} 步的嵌套子流程缺少业务名称。`, { nodeId: id, fixable: true, code: `nested_subflow_name_${i}` }));
        }
      }
      if (nested?.nodes) {
        const nestedAudit = auditWorkflow(nested, {});
        if (nestedAudit.counts.critical) {
          issues.push(issue("critical", "logic", "嵌套 Child Workflow 未通过设计检查", `「${n.title}」内部还有 ${nestedAudit.counts.critical} 个阻塞问题。`, { nodeId: id, fixable: true, code: "nested_subflow_audit" }));
        } else if (nestedAudit.counts.warning) {
          issues.push(issue("warning", "logic", "嵌套 Child Workflow 仍有建议项", `「${n.title}」内部还有 ${nestedAudit.counts.warning} 项建议完善。`, { nodeId: id, fixable: true, code: "nested_subflow_review" }));
        }
      }
    }

    if (n.type === "agent_call") {
      const call: AuditAgentCall = n.agentCall || {};
      if (!call.targetAgentId || !call.workflowId || !call.versionId) {
        issues.push(issue("critical", "handoff", "还没有选择可调用 Agent", `「${n.title}」无法执行；发布前请选择一个已发布 Agent。`, { nodeId: id, fixable: true, code: "agent_call_target" }));
      }
      if (call.targetAgentId === wf.rootAgent?.id) {
        issues.push(issue("critical", "logic", "Agent 不能调用自己", `「${n.title}」会形成循环调用，请选择其他已发布 Agent。`, { nodeId: id, fixable: true, code: "agent_call_self" }));
      }
      if (call.targetAgentId && !call.inputContract?.fields) {
        issues.push(issue("warning", "data", "协作 Agent 输入尚未冻结", `「${n.title}」没有记录目标 Agent 需要哪些输入；请重新选择该 Agent。`, { nodeId: id, fixable: true, code: "agent_call_input" }));
      }
      if (call.targetAgentId && !call.outputContract?.fields) {
        issues.push(issue("warning", "data", "协作 Agent 结果尚未冻结", `「${n.title}」没有记录目标 Agent 要返回什么；请重新选择该 Agent。`, { nodeId: id, fixable: true, code: "agent_call_output" }));
      }
      if (!["self", "team", "none"].includes(call.memoryAccess?.mode || "team")) {
        issues.push(issue("warning", "memory", "协作经验范围无法识别", `「${n.title}」需要选择只看对方经验、双方团队共享或本次不读取。`, { nodeId: id, fixable: true, code: "agent_call_memory" }));
      }
      if (!n.onErrorNext) {
        issues.push(issue("warning", "recovery", "协作 Agent 不可用时没有备用路径", `「${n.title}」失败时会安全暂停；建议连接员工处理或备用步骤。`, { nodeId: id, fixable: true, code: "agent_call_recovery" }));
      }
    }

    if (n.type === "handoff") {
      const c: AuditContract = n.contract || {};
      if (!n.toAgent?.id) {
        issues.push(issue("critical", "handoff", "Agent 交接缺少接收方", `「${n.title}」不知道交给哪个 Agent。`, { nodeId: id, fixable: true, code: "handoff_target" }));
      }
      if (!Array.isArray(c.deliverables) || !c.deliverables.length) {
        issues.push(issue("critical", "handoff", "交接没有必交内容", `「${n.title}」没有定义上游必须交付什么。`, { nodeId: id, fixable: true, code: "handoff_deliverables" }));
      }
      if (!Array.isArray(c.mustNotInclude) || !c.mustNotInclude.length) {
        issues.push(issue("critical", "handoff", "交接没有禁止传递边界", `「${n.title}」没有声明密钥、隐私或内部草稿等禁止传递内容。`, { nodeId: id, fixable: true, code: "handoff_prohibited" }));
      }
      if (!fieldSchemaOk(c.inputSchema)) {
        issues.push(issue("critical", "handoff", "交接输入 Schema 未定义", `「${n.title}」缺少结构化输入字段，无法安全执行交接。`, { nodeId: id, fixable: true, code: "handoff_input_schema" }));
      }
      if (!fieldSchemaOk(c.outputSchema)) {
        issues.push(issue("critical", "handoff", "交接输出 Schema 未定义", `「${n.title}」缺少下游可验证的输出结构，无法确认交接完成。`, { nodeId: id, fixable: true, code: "handoff_output_schema" }));
      }
      if (!c.memoryPolicy) {
        issues.push(issue("critical", "memory", "交接没有记忆边界", `「${n.title}」没有声明哪些上下文可以共享、哪些必须保持私有，无法安全执行交接。`, { nodeId: id, fixable: true, code: "handoff_memory" }));
      }
    }
  }

  for (const cyc of cycleIssues(wf)) {
    issues.push(issue("critical", "logic", "检测到非受控循环", `路径 ${cyc.map((id) => nodes[id]?.title || id).join(" → ")} 会形成循环，但没有经过 Loop 节点。`, { fixable: true, code: "uncontrolled_cycle" }));
  }

  const mp = memoryPolicy(wf);
  if (((wf.team?.agents as unknown[] | undefined)?.length ?? 0) > 1 && !mp) {
    issues.push(issue("warning", "memory", "Agent Team 缺少共享/私有记忆策略", "多 Agent 协作需要明确哪些信息共享、哪些信息只属于单个 Agent。", { fixable: true, code: "team_memory" }));
  }
  if (mp) {
    const prohibited = (mp.prohibited || []).map((x) => String(x).toLowerCase());
    for (const k of mp.shared || []) {
      if (prohibited.includes(String(k).toLowerCase())) {
        issues.push(issue("critical", "memory", "共享记忆与禁止项冲突", `「${k}」同时出现在共享记忆与禁止传递列表。`, { fixable: true, code: "memory_conflict" }));
      }
    }
  }

  const variables = Array.isArray(wf.variables) ? wf.variables : [];
  const varNames = new Set<string>();
  const runVariableTypes = new Map<string, string>();
  for (const v of variables) {
    const name = String(v?.name || "").trim();
    if (!name) {
      issues.push(issue("critical", "data", "业务变量缺少名称", "变量中心存在未命名变量，运行时无法稳定引用。", { fixable: true, code: "variable_name" }));
      continue;
    }
    if (v.scope === "run" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      issues.push(issue("critical", "data", "运行输入字段名不正确", `「${name}」必须以字母或下划线开头，并且只能包含字母、数字和下划线。`, { fixable: true, code: `variable_name_invalid_${name}` }));
    }
    if (varNames.has(name)) {
      issues.push(issue("critical", "data", "业务变量名称重复", `「${name}」被定义了多次。`, { fixable: true, code: `variable_duplicate_${name}` }));
    }
    varNames.add(name);
    if (v.scope === "run" && !runVariableTypes.has(name)) runVariableTypes.set(name, String(v.type || "string"));
    if (!["string", "number", "boolean", "object", "array", "any"].includes(v.type || "any")) {
      issues.push(issue("critical", "data", "业务变量类型不明确", `「${name}」使用了不支持的类型 ${v.type}。`, { fixable: true, code: `variable_type_${name}` }));
    }
    if (v.scope === "run" && (v.type || "string") === "any") {
      issues.push(issue("critical", "data", "运行输入类型不明确", `「${name}」需要选择文字、数字、是或否、对象或列表中的一种。`, { fixable: true, code: `variable_input_type_${name}` }));
    }
    if (v.scope === "shared" && /secret|token|password|api.?key/i.test(name)) {
      issues.push(issue("critical", "memory", "敏感变量不能设为共享", `「${name}」看起来属于凭证/密钥，不能进入 Agent Team 共享状态。`, { fixable: true, code: `variable_sensitive_${name}` }));
    }
  }

  const inputRequirements = new Map<string, Array<ReadonlySet<RuntimeInputType>>>();
  const requireInput = (requirement: { name: string; types: readonly RuntimeInputType[] } | null) => {
    if (!requirement) return;
    const requirements = inputRequirements.get(requirement.name) ?? [];
    requirements.push(new Set(requirement.types));
    inputRequirements.set(requirement.name, requirements);
  };
  for (const n of Object.values(nodes)) {
    if (n.type === "condition" && n.condition) {
      for (const branch of n.condition.branches || []) {
        if (!branch.rules?.length) requireInput(inputRequirement(n.condition.source, n.condition.operator, branch.value));
        for (const rule of branch.rules || []) requireInput(inputRequirement(rule.source, rule.operator, rule.value));
      }
    }
    if (n.type === "loop") {
      const parts = typeof n.loop?.collectionPath === "string" ? safeDataPathSegments(n.loop.collectionPath) : null;
      if (parts && ["input", "variables"].includes(parts[0]) && parts[1]) {
        requireInput({ name: parts[1], types: [parts.length > 2 ? "object" : "array"] });
      }
    }
  }
  for (const [name, requirements] of inputRequirements) {
    const declaredType = runVariableTypes.get(name);
    const allowed = ALL_RUNTIME_INPUT_TYPES.filter((type) => requirements.every((types) => types.has(type)));
    const mentioned = ALL_RUNTIME_INPUT_TYPES.filter((type) => requirements.some((types) => types.has(type)));
    const labels: Record<string, string> = { string: "文字", number: "数字", boolean: "是或否", object: "对象", array: "列表" };
    if (allowed.length === 0) {
      issues.push(issue("critical", "data", "运行输入被按不同格式使用", `「${name}」在流程中存在互不兼容的${mentioned.map((type) => labels[type]).join("、")}用法，无法生成可靠的运行表单。`, {
        fixable: true,
        code: `input_type_conflict_${name}`,
      }));
    } else if (declaredType && !allowed.includes(declaredType as RuntimeInputType)) {
      issues.push(issue("critical", "data", "运行输入类型与流程用法冲突", `「${name}」声明为${labels[declaredType] || declaredType}，但这里需要${allowed.map((type) => labels[type]).join("或")}。`, {
        fixable: true,
        code: `input_type_mismatch_${name}`,
      }));
    }
  }

  for (const id of ids) {
    const n = nodes[id];
    if (n.type === "condition") {
      const sources = [n.condition?.source, ...(n.condition?.branches || []).flatMap((b) => (b.rules || []).map((r) => r.source))].filter(Boolean).map(String);
      for (const src of sources) {
        if (src.startsWith("variables.")) {
          const name = src.slice("variables.".length).split(".")[0];
          if (name && !varNames.has(name)) {
            issues.push(issue("warning", "data", "条件引用了未定义变量", `「${n.title}」引用 variables.${name}，但变量中心没有定义。`, { nodeId: id, fixable: true, code: `condition_variable_${name}` }));
          }
        }
      }
    }
  }

  const ba: NonNullable<AuditBlueprint["businessArchitecture"]> = blueprint?.businessArchitecture || {};
  if (ba.humanResponsibilities?.length && !hasTypeRecursive(wf, "human")) {
    const nodesList = Object.values(wf?.nodes || {});
    const hasHighRiskTool = nodesList.some((n) => n.type === "tool" && (n.tool?.risk === "high" || /send|write|delete|pay|mail/i.test(n.tool?.action || n.tool?.scope || "")));
    const severity: AuditIssue["severity"] = hasHighRiskTool ? "critical" : "warning";
    issues.push(
      issue(
        severity,
        "consistency",
        "业务架构要求人工责任，但流程没有人工节点",
        hasHighRiskTool
          ? "Blueprint 与 Workflow 不一致：业务架构声明了高风险人工责任，但执行流程没有对应审批节点。"
          : "Blueprint 与 Workflow 不一致：业务架构曾声明人工责任，当前流程未包含人工节点。可一键对齐为全自动架构或补充审批节点。",
        { fixable: true, code: "architecture_human_mismatch" },
      ),
    );
  }
  if (ba.dataDependencies?.length && !hasTypeRecursive(wf, ["knowledge", "tool", "subflow"])) {
    issues.push(
      issue("warning", "consistency", "业务架构存在数据依赖，但流程没有读取步骤", "Blueprint 中声明了数据依赖，流程却没有知识、工具或子流程读取。可一键对齐业务架构，或在画布中补充知识库/工具节点。", {
        fixable: true,
        code: "architecture_data_mismatch",
      }),
    );
  }

  // 目标声明/开场白被误建成节点的检查：isConversationalOrMeta(undefined) 与旧实现 String(text||'') 等价
  for (const id of ids) {
    const n = nodes[id];
    const isControl = n?.controlPlane?.hiddenByDefault === true || n?.ui?.visibility === "control";
    if (isControl || ["trigger", "end"].includes(n?.type ?? "")) continue;
    if (
      isConversationalOrMeta(n?.title || "") ||
      /^(?:搭建|创建|制作|开发|配置|做|构建)?\s*(?:一个|个)?\s*[\p{Script=Han}a-zA-Z0-9_\-\s]{0,20}?\s*(?:的)?\s*(?:agent|助手|智能体|机器人|流程|工作流)$/iu.test(n?.title ?? "")
    ) {
      issues.push(
        issue("critical", "logic", "目标声明被误识别为工作流节点", `「${n.title}」是整体目标/Agent构建意图，不应该作为具体执行节点。AI 可自动将其移出流程并平滑重连前后节点。`, {
          nodeId: id,
          fixable: true,
          code: "meta_node_detected",
        }),
      );
    }
  }

  const uncovered = ((wf?.requirementContract?.coverage?.uncovered as Array<{ text?: string }> | undefined) || []).filter((item) => !isConversationalOrMeta(item.text || ""));
  if (uncovered.length) {
    issues.push(issue("warning", "consistency", "有明确需求尚未映射到画布", uncovered.slice(0, 4).map((item) => `“${item.text}”`).join("、"), { fixable: true, code: "requirement_coverage" }));
  }

  const businessGrounding = wf?.businessGrounding || null;
  const rawUncoveredExplicit = ((businessGrounding?.uncoveredExplicitRequirements as Array<{ text?: string }> | undefined) || []).filter((r) => !isConversationalOrMeta(r.text || ""));
  if (businessGrounding && (Number(businessGrounding.coveragePercent || 0) < 100 || rawUncoveredExplicit.length > 0)) {
    issues.push(
      issue(
        "critical",
        "grounding",
        "业务流程仍有未被需求证据支撑的部分",
        `当前业务节点证据覆盖率为 ${Number(businessGrounding.coveragePercent || 0)}%，还有 ${rawUncoveredExplicit.length} 条明确需求没有被真实业务节点承接。`,
        { fixable: true, code: "business_grounding_incomplete" },
      ),
    );
  }

  const businessExecutability = wf?.businessExecutability || null;
  if (businessExecutability && (businessExecutability.blockerCount as number) > 0) {
    issues.push(
      issue(
        "critical",
        "data",
        "业务流程存在无法证明真实可执行的数据来源",
        `当前有 ${businessExecutability.blockerCount} 个业务步骤缺少真实 Tool、Knowledge、运行输入或上游输出来源：${((businessExecutability.blockers as Array<{ title?: string }> | undefined) || [])
          .slice(0, 3)
          .map((x) => `“${x.title}”`)
          .join("、")}。`,
        { fixable: true, code: "business_source_unresolved" },
      ),
    );
  }

  for (const id of ids) {
    const n = nodes[id];
    const isControl = n?.controlPlane?.hiddenByDefault === true || n?.ui?.visibility === "control";
    if (isControl || ["trigger", "end"].includes(n?.type ?? "")) continue;
    const spec: AuditSpec | null | undefined = n?.businessSpec;
    if (!spec) {
      issues.push(
        issue("critical", "grounding", "业务节点没有业务规格", `「${n.title}」没有 businessSpec，无法证明它来自哪条真实需求、依赖什么输入以及什么才算完成。`, {
          nodeId: id,
          fixable: true,
          code: "business_spec_missing",
        }),
      );
      continue;
    }
    const grounding = spec.grounding || {};
    if (grounding.status === "weak" || Number(grounding.score || 0) < 0.45) {
      issues.push(issue("critical", "grounding", "业务节点缺少足够需求依据", `「${n.title}」没有足够的用户需求或业务规则证据支撑，建议删除、合并或补充真实业务依据。`, { nodeId: id, fixable: true, code: "business_node_ungrounded" }));
    }
    const done = ((spec.doneWhen as unknown[] | undefined) || []).map(String);
    if (!done.length || done.every((x) => /准确|完整|合理|可用|可供下一步|符合要求|处理完成|生成结果|执行成功/.test(x))) {
      issues.push(
        issue("warning", "grounding", "完成标准不可观察", `「${n.title}」的完成标准仍偏模板化，应该改成可以由输出字段、工具回执、分支结果或人工决定直接验证的条件。`, {
          nodeId: id,
          fixable: true,
          code: "business_done_not_observable",
        }),
      );
    }
    if (!((spec.evidence as unknown[] | undefined) || []).length) {
      issues.push(issue("critical", "grounding", "业务节点没有需求证据", `「${n.title}」没有记录它来自用户哪条需求，后续无法判断该节点是否真的必要。`, { nodeId: id, fixable: true, code: "business_evidence_missing" }));
    }
  }

  for (const id of ids) {
    const n = nodes[id];
    const match = forbiddenActionMatch(n as PolicyNode, wf?.businessPolicies?.forbiddenActions || []);
    if (match.matched) {
      issues.push(
        issue("critical", "grounding", "业务节点违反明确禁止项", `“${n.title}”与用户明确要求“${match.directive}”冲突。禁止项必须进入 Harness/Policy，而不能作为可执行业务动作。`, {
          nodeId: id,
          fixable: true,
          code: "business_forbidden_action_conflict",
        }),
      );
    }
  }

  const categories = ["flow", "logic", "permission", "data", "handoff", "memory", "recovery", "consistency", "grounding"];
  const weights: Record<string, number> = { critical: 12, warning: 5, info: 1 };
  const penalty = issues.reduce((s, x) => s + (weights[x.severity] || 0), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const counts = {
    critical: issues.filter((x) => x.severity === "critical").length,
    warning: issues.filter((x) => x.severity === "warning").length,
    info: issues.filter((x) => x.severity === "info").length,
  };
  const categoryStatus: DesignAuditResult["categoryStatus"] = categories.map((category) => {
    const xs = issues.filter((x) => x.category === category);
    return { category, status: xs.some((x) => x.severity === "critical") ? "blocked" : xs.length ? "review" : "good", issues: xs.length };
  });

  return {
    id: `AUDIT-${randomUUID()}`,
    score,
    status: counts.critical ? "blocked" : counts.warning ? "review" : "ready",
    counts,
    issues,
    categoryStatus,
    nodeCount: ids.length,
    edgeCount: edges.length,
    requirementCoverage: wf?.requirementContract?.coverage || null,
    complexityProfile: wf?.complexityProfile || null,
    checkedAt: new Date().toISOString(),
    schema: "design-audit/v5.7",
  };
}
