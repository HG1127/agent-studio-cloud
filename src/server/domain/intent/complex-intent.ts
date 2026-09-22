import { createHash } from "node:crypto";

export interface IntentGraphNode {
  id: string;
  title?: string;
  type?: string;
  description?: string;
  sourceLabel?: string;
  next?: string | null;
  onErrorNext?: string | null;
  requirementIds?: string[];
  intentEvidence?: { text?: string; stepRef?: string | null; source?: string } | null;
  approval?: { reason?: string; role?: string } | null;
  tool?: { action?: string; scope?: string; maxRetries?: number; risk?: string } | null;
  knowledge?: { query?: string } | null;
  system?: { kind?: string } | null;
  retry?: { maxAttempts?: number; backoffMs?: number } | null;
  parallel?: { branches?: unknown[] } | null;
  subflow?: { steps?: unknown[] } | null;
}

export interface IntentWorkflow {
  nodes: Record<string, IntentGraphNode>;
  id?: string;
  startNodeId?: string;
  rootAgent?: { id: string; name: string; role: string };
  memoryPolicy?: { taskContext?: boolean; longTerm?: boolean; description?: string };
  intentSource?: Record<string, unknown> | null;
  requirementContract?: Record<string, unknown> | null;
  complexityProfile?: Record<string, unknown> | null;
  runtimePolicy?: Record<string, unknown> | null;
}

export interface ComplexIntentInput {
  orderedSteps?: Array<{
    id?: string | null;
    title: string;
    type: string;
    source?: string;
    sourceLabel?: string | null;
    evidence?: string | null;
  }>;
  trigger?: { value?: string } | string;
  outputs?: Array<string | { name?: string }>;
  exceptions?: string[];
}

export interface RequirementItem {
  id: string;
  kind: string;
  label: string;
  text: string;
  required: boolean;
  source: string;
  sources: string[];
  stepRef: string | null;
}

export interface RequirementContract {
  schema: string;
  sourceText: string;
  requirements: RequirementItem[];
  createdAt: string;
}

export interface RequirementCoverageItem extends RequirementItem {
  covered: boolean;
  nodeIds: string[];
  matchedSteps: Array<{ id: string; title?: string; type?: string; confidence: number }>;
}

export interface RequirementCoverage {
  schema: string;
  covered: RequirementCoverageItem[];
  uncovered: RequirementCoverageItem[];
  requiredCount: number;
  coveredRequiredCount: number;
  percent: number;
  complete: boolean;
}

export interface ComplexityCapability {
  id: string;
  label: string;
  needed: boolean;
  implemented: boolean;
}

export type ComplexityProfile = {
  schema: string;
  level: string;
  label: string;
  score: number;
  capabilities: ComplexityCapability[];
  missing: ComplexityCapability[];
  summary: string;
};

const STRUCTURES = [
  { kind: "trigger", label: "什么时候开始", test: /^(?:当|一旦|收到|上传|提交|新建|创建|每天|每周|每月|每季|每个工作日|定时|工作日)|触发|启动|发生时|到点/i },
  { kind: "parallel", label: "哪些工作同时进行", test: /同时|并行|并发|分别处理|各自处理|同步开展|一边.+一边/i },
  { kind: "wait", label: "等待什么再继续", test: /等待|等到|直到|收到.+后|回调|回执到达|事件到达|稍后继续|延迟/i },
  { kind: "loop", label: "哪些内容逐项处理", test: /逐个|逐条|逐项|每个|分别对|批量|重复|循环|遍历/i },
  { kind: "subflow", label: "哪些工作交给独立子任务", test: /子流程|子任务|委派|交给另一个\s*(?:agent|助手)|独立工作单元/i },
  { kind: "condition", label: "如何分情况处理", test: /如果|若|当.+则|识别到.+时|检测到.+时|发现.+时|否则|满足|不满足|根据.+判断|分支/i },
  { kind: "human", label: "哪些决定交给员工", test: /人工|员工|负责人|主管|法务|财务|审批|批准|确认|复核/i },
  { kind: "recovery", label: "失败后怎么办", test: /失败|异常|超时|重试|降级|备用|兜底|回滚|补偿|恢复/i },
  { kind: "memory", label: "需要记住什么", test: /记住|记忆|历史|过往|上次|偏好|经验|长期/i },
  { kind: "output", label: "最终交付什么", test: /输出|交付|生成.+(?:报告|结果|方案|清单|文件|消息)|最终结果|返回/i },
  { kind: "tool", label: "需要操作哪些系统", test: /调用|接口|api|mcp|系统|数据库|飞书|微信|github|figma|邮件|日历|crm|设备/i },
  { kind: "constraint", label: "必须遵守的边界", test: /必须|不得|不要|禁止|仅限|不能|至少|最多|截止|保密|权限/i },
];

const TYPE_KIND: Record<string, string> = {
  trigger: "trigger",
  condition: "condition",
  loop: "loop",
  human: "human",
  tool: "tool",
  memory: "memory",
  parallel: "parallel",
  wait: "wait",
  subflow: "subflow",
  handoff: "subflow",
  end: "output",
};

function clean(value: unknown, limit = 240): string {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s，,；;。.!！？?]+|[\s，,；;。.!！？?]+$/g, "")
    .trim()
    .slice(0, limit);
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${createHash("sha1").update(String(value || "")).digest("hex").slice(0, 10)}`;
}

function unique(values: Array<string | undefined | null> | undefined): string[] {
  return [...new Set((values || []).filter((item): item is string => Boolean(item)))];
}

function kindFor(text: unknown, fallback = "action"): string {
  return STRUCTURES.find((item) => item.test.test(String(text || "")))?.kind || fallback;
}

function labelFor(kind: string): string {
  return STRUCTURES.find((item) => item.kind === kind)?.label || "需要完成的工作";
}

function tokens(value: unknown): Set<string> {
  const source = clean(value, 500).toLowerCase();
  const out = new Set(source.match(/[a-z][a-z0-9_.-]{2,}/g) || []);
  for (const block of source.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let index = 0; index < block.length - 1; index++) out.add(block.slice(index, index + 2));
  }
  return out;
}

function similarity(left: unknown, right: unknown): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const token of a) if (b.has(token)) hits += 1;
  return hits / Math.max(1, Math.min(a.size, b.size));
}

export function stripGoalPreamble(text: string): string {
  let s = String(text || "").trim();
  s = s.replace(
    /^(?:我(?:现在)?(?:想要|想|需要|打算|计划)?\s*)?(?:请)?(?:帮我)?(?:搭建|创建|制作|开发|配置|做|构建|设计|想要|想做)\s*(?:一个|个|一款|套)?\s*[\p{Script=Han}a-zA-Z0-9_\-\s]{0,30}?\s*(?:的)?\s*(?:agent|助手|智能体|机器人|流程|工作流|系统|应用)\s*(?:[，,；;：:\s]|(?:主要)?(?:用于|用来|去|负责|以|需|需要|请)|$)+/iu,
    "",
  );
  s = s.replace(
    /^(?:目标是|用于|用来|主要用来|主要用于|主要目标是)\s*(?:搭建|创建|制作|构建)?\s*(?:一个|个)?\s*[\p{Script=Han}a-zA-Z0-9_\-\s]{0,30}?\s*(?:的)?\s*(?:agent|助手|智能体|机器人|流程|工作流|系统|应用)\s*(?:[，,；;：:\s]|$)+/iu,
    "",
  );
  return s.trim();
}

export function isConversationalOrMeta(text: string): boolean {
  const s = String(text || "").trim();
  if (!s || s.length < 2) return true;
  if (
    /^(?:用户(?:补充|反馈|输入|要求)?[:：]|请(?:调整|解决|修复|优化|修改|检查|分析|重试|查看|完成|设计)|为什么|怎么|明明|这里|由于|导致|错误|报错|异常|阻塞|测试|验收|发布|候选版本|交付前检查|执行记录)/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/解决该流程里的阻塞问题|输出格式|没有读取理解|进入发布阶段|所有节点都已经验收通过|按格式输出|请认真分析/i.test(s)) return true;
  if (!stripGoalPreamble(s)) return true;
  if (
    /^(?:我(?:现在)?(?:想要|想|需要|打算|计划)?\s*)?(?:请)?(?:帮我)?(?:搭建|创建|制作|开发|配置|做|构建|设计|想要|想做)?\s*(?:一个|个|一款|套)?\s*[\p{Script=Han}a-zA-Z0-9_\-\s]{0,30}?\s*(?:的)?\s*(?:agent|助手|智能体|机器人|流程|工作流|系统|应用)[\s。，,！!？?；;]*$/iu.test(
      s,
    )
  ) {
    return true;
  }
  if (
    /^(?:目标是|用于|用来|主要用来|主要用于|主要目标是)\s*(?:搭建|创建|制作|构建)?\s*(?:一个|个)?\s*[\p{Script=Han}a-zA-Z0-9_\-\s]{0,30}?\s*(?:的)?\s*(?:agent|助手|智能体|机器人|流程|工作流|系统|应用)[\s。，,！!？?；;]*$/iu.test(
      s,
    )
  ) {
    return true;
  }
  if (
    /^(?:我(?:现在)?(?:想要|想|需要|打算|计划)?\s*(?:一个|个)?\s*[\p{Script=Han}a-zA-Z0-9_\-\s]{0,20}?\s*(?:的)?\s*(?:agent|助手|智能体|机器人|流程|工作流|系统))[\s。，,！!？?；;]*$/iu.test(
      s,
    )
  ) {
    return true;
  }
  return false;
}

function splitSource(text: string): string[] {
  const normalized = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[→➡➜]/g, "；")
    .replace(/\n+/g, "；")
    .replace(/(?:^|[；;。.!！？?]\s*)\d+[.、)]\s*/g, "；");
  const sentences = normalized
    .split(/[；;。.!！？?]+/)
    .map((item) => stripGoalPreamble(clean(item)))
    .filter((item) => item.length >= 3 && !isConversationalOrMeta(item));
  const clauses: string[] = [];
  for (const sentence of sentences) {
    const parts = sentence
      .split(
        /[，,]+(?=\s*(?:只要|只需|一旦|就(?:能|会|要)?|根据|基于|先|再|然后|随后|接着|同时|并行|分别|如果|若|否则|等待|直到|失败|成功|最后|输出|生成|发送|更新|写回|确认|审批|循环|逐个|逐条))/,
      )
      .map((item) => stripGoalPreamble(clean(item)))
      .filter((item) => Boolean(item) && !isConversationalOrMeta(item));
    clauses.push(...(parts.length ? parts : [sentence]));
  }
  return clauses.filter((item) => !isConversationalOrMeta(item)).slice(0, 40);
}

interface RequirementRowInput {
  text: string;
  kind?: string;
  source?: string;
  stepRef?: string | null;
  required?: boolean;
}

function intentRequirements(intent: ComplexIntentInput, sourceText: string): RequirementRowInput[] {
  const rows: RequirementRowInput[] = [];
  const trigger = clean((intent.trigger as { value?: string } | undefined)?.value || intent.trigger);
  if (trigger && !isConversationalOrMeta(trigger)) rows.push({ text: trigger, kind: "trigger", source: "intent-trigger" });
  for (const step of intent.orderedSteps || []) {
    const text = clean(step.evidence || step.title);
    if (isConversationalOrMeta(text) || isConversationalOrMeta(step.title)) continue;
    const generated =
      step.source === "system" ||
      /根据任务复杂度加入|根据完整闭环要求加入|根据你的.+要求加入|安全边界|系统自动检查/.test(String(step.sourceLabel || ""));
    if (text && !generated) rows.push({ text, kind: TYPE_KIND[step.type] || kindFor(text), source: "intent-step", stepRef: step.id || null });
  }
  for (const output of intent.outputs || []) {
    const text = clean(typeof output === "string" ? output : output?.name);
    if (text && !isConversationalOrMeta(text)) rows.push({ text, kind: "output", source: "intent-output" });
  }
  for (const exception of intent.exceptions || []) {
    const text = clean(exception);
    if (text && !isConversationalOrMeta(text)) rows.push({ text, kind: "recovery", source: "intent-exception", required: similarity(text, sourceText) >= 0.3 });
  }
  return rows;
}

function addRequirement(target: RequirementItem[], row: RequirementRowInput): void {
  const text = clean(row.text);
  if (!text || isConversationalOrMeta(text)) return;
  const duplicate = target.find((item) => item.kind === row.kind && similarity(item.text, text) >= 0.72);
  if (duplicate) {
    duplicate.sources = unique([...(duplicate.sources || []), row.source]);
    if (row.stepRef && !duplicate.stepRef) duplicate.stepRef = row.stepRef;
    return;
  }
  target.push({
    id: stableId("REQ", `${row.kind}:${text}`),
    kind: row.kind || kindFor(text),
    label: labelFor(row.kind || kindFor(text)),
    text,
    required: row.required !== false,
    source: row.source || "user",
    sources: [row.source || "user"],
    stepRef: row.stepRef || null,
  });
}

export function buildRequirementContract(sourceText = "", intent: ComplexIntentInput = {}): RequirementContract {
  const requirements: RequirementItem[] = [];
  for (const row of intentRequirements(intent, sourceText)) addRequirement(requirements, row);
  for (const clause of splitSource(sourceText)) addRequirement(requirements, { text: clause, kind: kindFor(clause), source: "user" });
  return {
    schema: "agent-requirements/v3.6",
    sourceText: clean(sourceText, 2000),
    requirements: requirements.slice(0, 48),
    createdAt: new Date().toISOString(),
  };
}

function nodeCorpus(node: IntentGraphNode): string {
  return [
    node?.title,
    node?.description,
    node?.intentEvidence?.text,
    node?.sourceLabel,
    node?.approval?.reason,
    node?.tool?.action,
    node?.tool?.scope,
    node?.knowledge?.query,
  ]
    .filter(Boolean)
    .join(" ");
}

function structuralScore(requirement: RequirementItem, node: IntentGraphNode): number {
  const expected = TYPE_KIND[node?.type || ""] || node?.type;
  if (requirement.kind === expected) return 0.55;
  if (requirement.kind === "recovery" && (node?.onErrorNext || node?.retry || node?.tool?.maxRetries)) return 0.5;
  if (requirement.kind === "constraint" && ["rule", "human", "condition"].includes(node?.type || "")) return 0.35;
  if (requirement.kind === "output" && (node?.system?.kind === "deliver_output" || node?.type === "end")) return 0.55;
  return 0;
}

export function coverageFor(workflow: IntentWorkflow, contract: RequirementContract): RequirementCoverage {
  const nodes = Object.values(workflow?.nodes || {});
  const covered: RequirementCoverageItem[] = [];
  const uncovered: RequirementCoverageItem[] = [];
  for (const requirement of contract.requirements || []) {
    if (isConversationalOrMeta(requirement.text)) continue;
    const ranked = nodes
      .map((node) => ({
        node,
        score:
          requirement.stepRef && (requirement.stepRef === node.id || requirement.stepRef === node.intentEvidence?.stepRef)
            ? 1
            : Math.min(1, similarity(requirement.text, nodeCorpus(node)) + structuralScore(requirement, node)),
      }))
      .sort((left, right) => right.score - left.score);
    const matches = ranked.filter((item) => item.score >= 0.42).slice(0, 4);
    const item: RequirementCoverageItem = {
      ...requirement,
      covered: matches.length > 0,
      nodeIds: matches.map((match) => match.node.id),
      matchedSteps: matches.map((match) => ({
        id: match.node.id,
        title: match.node.title,
        type: match.node.type,
        confidence: Number(match.score.toFixed(2)),
      })),
    };
    (item.covered ? covered : uncovered).push(item);
  }
  const required = (contract.requirements || []).filter((item) => item.required !== false && !isConversationalOrMeta(item.text));
  const requiredCovered = covered.filter((item) => item.required !== false);
  return {
    schema: "agent-requirement-coverage/v3.6",
    covered,
    uncovered,
    requiredCount: required.length,
    coveredRequiredCount: requiredCovered.length,
    percent: required.length ? Math.round((requiredCovered.length / required.length) * 100) : 100,
    complete: uncovered.filter((item) => item.required !== false).length === 0,
  };
}

function nestedTypes(node: IntentGraphNode): string[] {
  const values: string[] = [];
  if (node?.type === "parallel") {
    for (const branch of (node.parallel?.branches || []) as Array<{ steps?: Array<{ type?: string }> }>) {
      for (const step of branch.steps || []) values.push(step.type || "ai");
    }
  }
  if (node?.type === "subflow") {
    for (const step of (node.subflow?.steps || []) as Array<{ type?: string }>) values.push(step.type || "ai");
  }
  return values;
}

const COMPLEXITY_LEVEL_LABELS: Record<string, string> = {
  simple: "简单任务",
  structured: "多步骤任务",
  complex: "复杂业务流程",
  advanced: "高级协同流程",
};

export function analyzeWorkflowComplexity(
  workflow: IntentWorkflow = { nodes: {} },
  contract: RequirementContract | null = null,
): ComplexityProfile {
  const nodes = Object.values(workflow?.nodes || {});
  const types = nodes.flatMap((node) => [node.type, ...nestedTypes(node)]);
  const requirements = contract?.requirements || [];
  const has = (type: string, kind = type) => types.includes(type) || requirements.some((item) => item.kind === kind);
  const capabilities: ComplexityCapability[] = [
    { id: "branches", label: "按不同情况走不同路径", needed: has("condition"), implemented: types.includes("condition") },
    { id: "parallel", label: "多项工作可以同时进行", needed: has("parallel"), implemented: types.includes("parallel") },
    { id: "loop", label: "能逐项处理一批内容", needed: has("loop"), implemented: types.includes("loop") },
    { id: "wait", label: "能等待时间或外部消息后继续", needed: has("wait"), implemented: types.includes("wait") },
    { id: "subflow", label: "复杂工作可拆成独立子任务", needed: has("subflow"), implemented: types.includes("subflow") },
    { id: "human", label: "关键决定会交给员工", needed: has("human"), implemented: types.includes("human") },
    { id: "tools", label: "能调用已连接的真实业务系统", needed: has("tool"), implemented: types.includes("tool") },
    { id: "memory", label: "能按要求参考和保存经验", needed: has("memory"), implemented: types.includes("memory") },
    {
      id: "recovery",
      label: "局部失败可重试或走备用路径",
      needed: requirements.some((item) => item.kind === "recovery") || nodes.some((node) => node.type === "tool"),
      // retry.maxAttempts / tool.maxRetries 旧代码依赖 undefined>1 为 false 的语义，?? 0 等价改写
      implemented: nodes.some(
        (node) => node.onErrorNext || (node.retry?.maxAttempts ?? 0) > 1 || (node.tool?.maxRetries ?? 0) > 1,
      ),
    },
  ];
  const needed = capabilities.filter((item) => item.needed);
  const missing = needed.filter((item) => !item.implemented);
  const score = needed.length ? Math.round(((needed.length - missing.length) / needed.length) * 100) : 100;
  const structuralCount = needed.length;
  const level = structuralCount >= 7 ? "advanced" : structuralCount >= 5 ? "complex" : structuralCount >= 3 ? "structured" : "simple";
  return {
    schema: "agent-complexity-profile/v3.6",
    level,
    label: COMPLEXITY_LEVEL_LABELS[level],
    score,
    capabilities,
    missing,
    summary: missing.length
      ? `已识别 ${needed.length} 类任务结构，还有 ${missing.length} 类需要补齐。`
      : `已覆盖 ${needed.length} 类任务结构，运行时会按画布执行。`,
  };
}

export function attachComplexIntentContract(
  workflow: IntentWorkflow,
  intent: ComplexIntentInput = {},
  sourceText = "",
): IntentWorkflow {
  if (!workflow?.nodes) return workflow;
  const next = structuredClone(workflow);
  const contract = buildRequirementContract(sourceText, intent);
  const coverage = coverageFor(next, contract);
  for (const covered of coverage.covered) {
    for (const nodeId of covered.nodeIds) {
      const node = next.nodes[nodeId];
      if (node) node.requirementIds = unique([...(node.requirementIds || []), covered.id]);
    }
  }
  next.requirementContract = { ...contract, coverage };
  next.complexityProfile = analyzeWorkflowComplexity(next, contract);
  next.runtimePolicy = {
    schema: "agent-runtime-policy/v3.6",
    durable: true,
    resumable: true,
    checkpointEveryStep: true,
    maxSteps: Math.max(80, Math.min(600, Object.keys(next.nodes).length * 20)),
    maxDurationMs: 30 * 60 * 1000,
    localRecoveryFirst: true,
    ...(next.runtimePolicy || {}),
  };
  next.intentSource = {
    ...(next.intentSource || {}),
    requirementCoverage: coverage,
    complexityProfile: next.complexityProfile,
    compilerVersion: "3.6",
  };
  return next;
}
