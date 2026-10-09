import { createHash, randomUUID } from "node:crypto";
import { WorkflowDraft } from "@/contracts/workflow";
import { isConversationalOrMeta, stripGoalPreamble } from "./complex-intent";

export interface IntentStep {
  id: string;
  order: number;
  title: string;
  type: string;
  owner: string;
  toolId: string | null;
  toolLabel: string | null;
  source: "user" | "attachment" | "system";
  sourceLabel: string;
  evidence: string;
  branch?: string | null;
  parallel?: ParallelSpec;
  wait?: WaitSpec;
  retry?: { maxAttempts: number; backoffMs: number } | null;
}

export interface CompileIntentWorkflowOptions {
  text: string;
  name: string;
  domain?: { name?: string };
  caps?: unknown[];
  trigger?: { value?: string } | string;
  humanReasons?: string[];
  sourceType?: "idea" | "attachment";
}

const ACTION_WORDS =
  "读取|查询|搜索|检索|整理|总结|分析|判断|识别|检查|核对|审查|评估|润色|改写|提取|计算|比对|分组|分类|生成|起草|发送|外发|通知|提醒|更新|写回|回写|记录|同步|安排|创建|确认|审批|批准|复核|付款|支付|归档|输出|形成";
const CONNECTOR_RE = /^[\s]*(?:先|再|然后|之后|接着|随后|并且|并把|并将|并|同时|最后)\s*/;

function clean(value: unknown): string {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[，,；;。]+|[，,；;。]+$/g, "")
    .trim();
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function rootAgent(name: string, domain?: { name?: string }): { id: string; name: string; role: string } {
  return { id: `agt_${randomUUID().slice(0, 8)}`, name, role: `${domain?.name || "业务"}助手` };
}

function isNegativeDirective(text = ""): boolean {
  return /^(?:不要|无需|无须|禁止|不得|不允许|不需要|避免|不会|不)\s*(?:对外)?(?:发送|外发|发出|发邮件|发送邮件|写回|回写|更新|修改|删除|付款|支付|创建|通知|同步|记录|发布)/i.test(
    clean(text),
  );
}

export function splitIntentClauses(text: string): string[] {
  let normalized = String(text || "")
    .replace(/\r?\n+/g, "；")
    .replace(/[→➡➜]/g, "；");
  normalized = normalized
    .replace(
      /[，,](?=\s*(?:然后|再|之后|接着|随后|最后|同时|并(?:且|把|将)?|必须|如果|若|当|缺少|没有|未|资料完整|信息完整|否则|无论))/g,
      "；",
    )
    .replace(/[，,](?=\s*按[^，,；;。]{1,28}(?:分组|分类|排序))/g, "；");
  normalized = normalized.replace(new RegExp(`[，,](?=\\s*(?:${ACTION_WORDS}))`, "g"), "；");
  return normalized
    .split(/[；;。!?！？]+/)
    .map((part) => stripGoalPreamble(clean(part)))
    .filter((part) => part.length >= 2 && !isConversationalOrMeta(part))
    .slice(0, 30);
}

function stripTrigger(clause: string): string {
  const value = clean(clause);
  if (!/^(?:每天|每周|每月|每季度|每年|每个工作日|工作日|定时|实时|一旦|当|收到|上传|提交|新建|创建)/.test(value)) return value;
  const action = new RegExp(`(?:${ACTION_WORDS})`, "i").exec(value);
  return action && action.index > 0 ? clean(value.slice(action.index)) : value;
}

const CAPABILITY_DOMAINS: Array<[RegExp, RegExp, string]> = [
  [/crm|客户系统|客户|商机|线索|联系人/i, /crm|customer|client|lead|contact|sales|客户|商机|线索|联系人/i, "crm"],
  [/创建待办|生成待办|补充资料待办|回访任务|任务系统|工单/i, /task|todo|ticket|待办|任务|工单/i, "tasks"],
  [/通知主管|通知负责人|企业微信|飞书|钉钉|内部消息/i, /slack|teams|wecom|feishu|message|notify|通知|消息/i, "workchat"],
  [/付款|支付|报销系统|财务系统|发票系统/i, /pay|payment|finance|invoice|expense|付款|支付|财务|发票|报销/i, "finance"],
  [/邮件|email|邮箱|外发/i, /mail|email|message|邮件|邮箱/i, "mail"],
  [/日历|会议|面试|预约/i, /calendar|meeting|interview|schedule|日历|会议|面试|预约/i, "calendar"],
  [/招聘系统|候选人系统|候选人|简历|岗位|ats/i, /recruit|candidate|resume|job|ats|招聘|候选人|简历|岗位/i, "recruiting"],
];
const CAPABILITY_ACTIONS: Array<[RegExp, RegExp]> = [
  [/读取|查询|搜索|检索|获取|查看|列出/i, /read|get|list|search|query|fetch|lookup|读取|查询|搜索|检索|获取|查看/i],
  [/创建|新增|生成|安排|提交/i, /create|add|new|schedule|submit|post|创建|新增|生成|安排|提交/i],
  [/更新|修改|写回|回写|同步|记录/i, /update|edit|write|upsert|sync|record|patch|更新|修改|写回|同步|记录/i],
  [/发送|外发|通知|提醒/i, /send|mail|notify|message|发送|通知|提醒/i],
  [/删除|取消|撤销/i, /delete|remove|cancel|revoke|删除|取消|撤销/i],
  [/付款|支付|执行/i, /pay|payment|execute|run|付款|支付|执行/i],
];

interface CapTool {
  name?: string;
  id?: string;
  suggestedScope?: string;
  protocol?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

interface CapabilityRecord {
  id: string;
  label?: string;
  action?: string;
  searchText?: string;
  scope?: string;
  source?: string;
  matchScore?: number;
  risk?: string;
  registryToolId?: string | null;
  protocol?: string;
  operationKind?: "read" | "action";
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  availableTools?: CapTool[];
}

function capabilityScore(text: string, cap: CapabilityRecord): number {
  const source = String(text || "");
  const corpus = `${cap.label || ""} ${cap.action || ""} ${cap.searchText || ""} ${cap.id || ""}`.toLowerCase();
  let score = 0;
  if (/待办|任务|工单/.test(source) && cap.id === "tasks") score += 12;
  for (const [intent, tool, builtinId] of CAPABILITY_DOMAINS) {
    if (intent.test(source) && (cap.id === builtinId || tool.test(corpus))) score += 8;
  }
  for (const [intent, tool] of CAPABILITY_ACTIONS) {
    if (intent.test(source)) {
      if (tool.test(corpus)) score += 4;
      else if (cap.source === "connected-registry") score -= 6;
    }
  }
  const normalizedSource = source.toLowerCase();
  const directNames = [cap.label, cap.id]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => value.length >= 2);
  if (directNames.some((value) => normalizedSource.includes(value))) score += 6;
  if (cap.source === "connected-registry") score += Math.min(2, Number(cap.matchScore || 0) / 8);
  return score;
}

function toolFor(text: string, caps: CapabilityRecord[]): CapabilityRecord | null {
  const ranked = (caps || [])
    .map((cap) => ({ cap, score: capabilityScore(text, cap) }))
    .filter((row) =>
      ["connected-registry", "selected-resource"].includes(row.cap.source || "") ? row.score >= 7 : row.score > 0,
    )
    .sort(
      (a, b) =>
        b.score - a.score || Number(b.cap.source === "connected-registry") - Number(a.cap.source === "connected-registry"),
    );
  return ranked[0]?.cap || null;
}

function actionType(text: string, caps: CapabilityRecord[]): string {
  const source = String(text || "");
  if (/确认|审批|批准|复核|人工决定/.test(source) && !/自动确认/.test(source)) return "human";
  const matchedTool = toolFor(source, caps);
  if (matchedTool?.source === "connected-registry" && matchedTool.protocol === "mcp-streamable-http"
    && [matchedTool.label, matchedTool.id].some((name) => name && name.length >= 2 && source.toLowerCase().includes(name.toLowerCase()))
    && /读取|查询|搜索|检索|获取|创建|新增|发送|外发|通知|提醒|更新|修改|写回|回写|同步|记录|删除|付款|支付|执行/.test(source)) return "tool";
  if (/读取|查询|搜索|检索|参考|查阅/.test(source) && /知识库|文档|制度|sop|合同|资料|规范|标准|指南|手册|政策|规则/.test(source)) {
    return "knowledge";
  }
  if (
    /失败|异常|未完成/.test(source) &&
    /说明|提示|记录|保留|转交|转人工|停止|结束/.test(source) &&
    !/重新(?:读取|查询|调用)|重试/.test(source)
  ) {
    return "system";
  }
  if (
    matchedTool?.source === "connected-registry" &&
    /(读取|查询|搜索|检索|获取|创建|新增|发送|外发|通知|提醒|更新|修改|写回|回写|同步|记录|删除|付款|支付|执行)/.test(source)
  ) {
    return "tool";
  }
  if (matchedTool && /(付款|支付|创建待办|生成待办|补充资料待办|普通付款待办|回访任务|通知主管|通知负责人|企业微信|飞书|钉钉|内部消息)/.test(source)) {
    return "tool";
  }
  if (
    (/crm|客户系统|招聘系统|ats/i.test(source) && /(读取|查询|搜索|检索|写回|回写|更新|记录|同步)/.test(source)) ||
    (/发送|外发|发出/.test(source) && caps.some((cap) => cap.id === "mail")) ||
    /(发送|外发|发出).{0,8}(?:邮件|通知)|(?:邮件|通知).{0,8}(?:发送|外发|发出)|创建.{0,8}(?:日历|会议)|安排.{0,8}(?:日历|会议)/i.test(source)
  ) {
    return toolFor(source, caps) ? "tool" : "system";
  }
  if (/检查|校验|去重|格式化|归档|保存|记录/.test(source) && !/分析|判断|识别|生成|总结/.test(source)) return "system";
  return "ai";
}

function actionTitle(text: string, type: string, cap: CapabilityRecord | null): string {
  let title = clean(text)
    .replace(CONNECTOR_RE, "")
    .replace(/^(?:帮|请|让)\s*(?:我|AI|Agent)?\s*/i, "");
  title = title.replace(/^(?:必须|需要)\s*/, "").replace(/^把\s*/, "");
  if (type === "tool" && cap?.source === "connected-registry") return `${cap.label || "业务系统"}：${title.slice(0, 38) || "执行已连接操作"}`;
  if (type === "tool" && cap?.id === "crm" && /(读取|查询|搜索|检索)/.test(title)) return "从 CRM 读取需要处理的客户";
  if (type === "tool" && cap?.id === "crm" && /(写回|回写|更新|记录|同步)/.test(title)) return "把处理结果写回 CRM";
  if (type === "tool" && cap?.id === "mail") return "发送已确认的邮件";
  if (type === "tool" && cap?.id === "calendar") return "创建已确认的日程";
  if (type === "tool" && cap?.id === "finance") return "通过财务系统执行已确认付款";
  if (type === "tool" && cap?.id === "tasks") return /补充/.test(title) ? "创建补充资料待办" : "创建后续任务";
  if (type === "tool" && cap?.id === "workchat") return "向相关负责人发送内部通知";
  if (type === "human") {
    const role = (title.match(/由\s*([^，,；;]{1,20}?)\s*(?:确认|审批|批准|复核)/) || [])[1];
    const target = /发送|邮件/.test(title) ? "发送内容" : /付款|支付/.test(title) ? "付款" : "处理结果";
    return `${clean(role) || "业务负责人"}确认${target}`;
  }
  return title.slice(0, 48) || "处理业务信息";
}

interface BuildToolSpec {
  connector: string;
  action?: string;
  intentAction?: string;
  scope?: string;
  maxRetries: number;
  checkpointOnFailure: boolean;
  risk: string;
  registryToolId?: string | null;
  protocol?: string;
  operationKind?: "read" | "action";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  argumentsMode?: string;
  businessApprovalAccepted?: boolean;
}

function toolSpec(text: string, cap: CapabilityRecord | null): BuildToolSpec | null {
  const source = String(text || "");
  if (!cap) return null;
  if (cap.source === "connected-registry") {
    const intentAction = /(读取|查询|搜索|检索|获取|查看|列出)/.test(source)
      ? "read_records"
      : /(发送|外发|通知|提醒)/.test(source)
        ? "send_content"
        : /(创建|新增|生成|安排|提交)/.test(source)
          ? "create_record"
          : /(删除|取消|撤销)/.test(source)
            ? "delete_record"
            : "update_record";
    return {
      connector: cap.id,
      action: cap.action,
      intentAction,
      scope: cap.scope,
      maxRetries: cap.risk === "high" ? 3 : 2,
      checkpointOnFailure: true,
      risk: cap.risk || "high",
      registryToolId: cap.registryToolId,
      protocol: cap.protocol,
      ...(cap.operationKind !== undefined ? { operationKind: cap.operationKind } : {}),
      inputSchema: cap.inputSchema || { type: "object" },
      outputSchema: cap.outputSchema || {},
      argumentsMode: "auto",
    };
  }
  let action = "update_business_record";
  let risk = cap.risk || "medium";
  let scope = cap.scope;
  if (cap.id === "crm") {
    const read = /(读取|查询|搜索|检索)/.test(source);
    action = read ? "read_records" : "write_followup";
    scope = read ? "crm.followup.read" : cap.scope;
  }
  if (cap.id === "mail") action = "send_approved_content";
  if (cap.id === "calendar") action = "create_business_event";
  if (cap.id === "recruiting") action = /(读取|查询|搜索|检索)/.test(source) ? "read_candidates" : "update_candidate";
  if (cap.id === "finance") action = "execute_approved_payment";
  if (cap.id === "tasks") action = "create_task";
  if (cap.id === "workchat") action = "send_internal_message";
  if (/读取|查询|搜索|检索/.test(source)) risk = "low";
  const compatible = (cap.availableTools || []).filter((tool) => tool.suggestedScope === scope);
  const selected = (cap.availableTools || []).find((tool) => tool.name === action) || (compatible.length === 1 ? compatible[0] : null);
  return {
    connector: cap.id,
    action,
    scope,
    maxRetries: risk === "high" ? 3 : 2,
    checkpointOnFailure: true,
    risk,
    registryToolId: selected?.id || cap.registryToolId || null,
    protocol: selected?.protocol || cap.protocol || "sandbox-native",
    inputSchema: selected?.inputSchema || cap.inputSchema || { type: "object" },
    outputSchema: selected?.outputSchema || cap.outputSchema || {},
  };
}

interface ActionApproval {
  role: string;
  reason: string;
}

interface ActionItem {
  title: string;
  type: string;
  owner?: string;
  evidence: string;
  sourceLabel: string;
  branch?: string | null;
  approval?: ActionApproval;
  tool?: BuildToolSpec | null;
  toolLabel?: string | null;
  modelClass?: string;
  knowledge?: { space: string; query: string };
  parallel?: ParallelSpec;
  wait?: WaitSpec;
  retry?: { maxAttempts: number; backoffMs: number } | null;
  controlPlane?: { kind: string; hiddenByDefault: boolean };
  purpose?: string;
}

function parseActions(
  text: string,
  caps: CapabilityRecord[],
  domain: { name?: string } | undefined,
  sourceLabel: string,
): ActionItem[] {
  const stripped = stripGoalPreamble(clean(text));
  const source = stripped.replace(CONNECTOR_RE, "");
  if (!source || isConversationalOrMeta(source)) return [];
  const contrast = source
    .split(/(?:，|,)?(?:但是|但要|但需|但)(?=\s*(?:要|需要|生成|输出|保留|只|仅|读取|分析|判断))/)
    .map(clean)
    .filter(Boolean);
  if (contrast.length > 1) return contrast.flatMap((part) => parseActions(part, caps, domain, sourceLabel));
  if (isNegativeDirective(source)) return [];
  if (/^(?:保存|记住).{0,12}(?:经验|偏好|历史)|保存本次.{0,12}(?:经验|记录)/.test(source)) return [];
  const compound = source
    .split(new RegExp(`并(?:且|把|将)?(?=(?:${ACTION_WORDS}))`))
    .map(clean)
    .filter(Boolean);
  if (compound.length > 1) return compound.flatMap((part) => parseActions(part, caps, domain, sourceLabel));
  const roleMatch = source.match(/(?:必须)?由\s*([^，,；;]{1,24}?)\s*(?:确认|审批|批准|复核)后(?:才能|才)?\s*(.+)$/);
  if (roleMatch) {
    const role = clean(roleMatch[1]);
    const after = clean(roleMatch[2]);
    const human: ActionItem = {
      title: `${role}确认${/发送|邮件/.test(after) ? "发送内容" : /付款|支付/.test(after) ? "付款" : "处理结果"}`,
      type: "human",
      owner: role,
      evidence: source,
      approval: { role, reason: `按你的要求，由 ${role} 确认后才继续` },
      sourceLabel,
    };
    return [human, ...parseActions(after, caps, domain, sourceLabel)];
  }
  const beforeMatch = source.match(/^(.+?)(?:发送|执行|付款|支付)前(?:必须|需要)?由\s*([^，,；;]{1,24}?)\s*(?:确认|审批|批准|复核)$/);
  if (beforeMatch) {
    const role = clean(beforeMatch[2]);
    return [
      {
        title: `${role}确认处理结果`,
        type: "human",
        owner: role,
        evidence: source,
        approval: { role, reason: `按你的要求，由 ${role} 确认后才继续` },
        sourceLabel,
      },
    ];
  }
  const cap = toolFor(source, caps);
  const type = actionType(source, caps);
  const ownerName =
    type === "human"
      ? (source.match(/由\s*([^，,；;]{1,20}?)\s*(?:确认|审批|批准|复核)/) || [])[1] || "业务负责人"
      : type === "tool"
        ? "已连接的业务系统"
        : `${domain?.name || "业务"}助手`;
  const item: ActionItem = { title: actionTitle(source, type, cap), type, owner: clean(ownerName), evidence: source, sourceLabel };
  if (type === "tool") {
    item.tool = toolSpec(source, cap);
    item.toolLabel = cap?.label || null;
  }
  if (type === "human") item.approval = { role: item.owner as string, reason: `确认「${item.title}」后流程才会继续` };
  if (type === "ai") item.modelClass = /规划|研究|推理|判断|分析/.test(source) ? "reasoning" : "balanced";
  if (type === "knowledge") item.knowledge = { space: "业务知识库", query: source };
  return [item];
}

function safeEventKey(label: string): string {
  return `event_${createHash("sha1").update(String(label || "business_event")).digest("hex").slice(0, 10)}`;
}

interface ParallelBranchStep {
  id: string;
  title: string;
  type: string;
  description?: string;
  modelClass?: string;
  tool?: BuildToolSpec | null;
  knowledge?: { space: string; query: string };
  approval?: ActionApproval;
}

interface ParallelBranch {
  id: string;
  label: string;
  steps: ParallelBranchStep[];
  outputs: string[];
}

interface ParallelSpec {
  strategy: string;
  failurePolicy: string;
  branches: ParallelBranch[];
}

function parseParallelTask(
  raw: string,
  caps: CapabilityRecord[],
  domain: { name?: string } | undefined,
  sourceLabel: string,
): ActionItem | null {
  const source = clean(raw);
  if (!/(?:^|，|,)(?:同时|并行|分别)|同步开展|一边.+一边|.+同时(?:开展|进行|处理)/.test(source)) return null;
  const body = source
    .replace(/^(?:并且|然后|再)?\s*(?:同时|并行|分别)\s*/, "")
    .replace(/同步开展/g, "开展");
  const reversed = body.match(/^(.{1,32}?)(?:和|与|以及|、)(.{1,32}?)同时(?:开展|进行|处理)?(.{1,20})$/);
  let parts: string[] = [];
  if (reversed) {
    const action = clean(reversed[3]).replace(/^(?:开展|进行|处理)/, "") || "分析";
    parts = [`${action}${clean(reversed[1])}`, `${action}${clean(reversed[2])}`];
  } else {
    const actionMatch = body.match(new RegExp(`^(${ACTION_WORDS})(.+)$`));
    if (actionMatch) {
      const verb = actionMatch[1];
      const targets = actionMatch[2]
        .split(
          /、|以及|和|与|并且|并(?=(?:读取|查询|搜索|检索|整理|总结|分析|判断|识别|检查|核对|审查|评估|润色|改写|提取|计算|比对|生成|起草))/,
        )
        .map(clean)
        .filter(Boolean);
      parts = targets.map((target) => (new RegExp(`^(?:${ACTION_WORDS})`).test(target) ? target : `${verb}${target}`));
    } else {
      parts = body
        .split(/、|以及|和|与|并且/)
        .map(clean)
        .filter(Boolean);
    }
  }
  parts = uniq(parts)
    .filter((part) => part.length >= 2)
    .slice(0, 8);
  if (parts.length < 2) return null;
  const branches = parts.map((part, index) => {
    const steps = parseActions(part, caps, domain, sourceLabel);
    const normalized: ActionItem[] = steps.length
      ? steps
      : [{ title: part, type: "ai", owner: `${domain?.name || "业务"}助手`, evidence: source, sourceLabel, modelClass: "balanced" }];
    return {
      id: `parallel_${randomUUID().slice(0, 6)}_${index + 1}`,
      label: normalized.map((item) => item.title).join(" → "),
      steps: normalized.map((item, stepIndex) => ({
        id: `branch_${index + 1}_${stepIndex + 1}`,
        title: item.title,
        type: item.type,
        description: item.evidence,
        modelClass: item.modelClass,
        tool: item.tool,
        knowledge: item.knowledge,
        approval: item.approval,
      })),
      outputs: [`${normalized.at(-1)?.title || part}结果`],
    };
  });
  return {
    title: `同时完成 ${branches.length} 项工作`,
    type: "parallel",
    owner: `${domain?.name || "业务"}助手`,
    evidence: source,
    sourceLabel,
    parallel: { strategy: "all", failurePolicy: "fail_fast", branches },
  };
}

type WaitSpec =
  | { mode: "delay"; durationMs: number; eventKey: string; eventLabel: string; timeoutMs: number }
  | { mode: "until"; until: string; eventKey: string; eventLabel: string; timeoutMs: number }
  | {
      mode: "event";
      eventKey: string;
      eventLabel: string;
      payloadSchema: { type: string };
      timeoutMs: number;
      onTimeoutNext: string | null;
    };

function parseWaitTasks(
  raw: string,
  caps: CapabilityRecord[],
  domain: { name?: string } | undefined,
  sourceLabel: string,
  index = 0,
): ActionItem[] | null {
  const source = clean(raw);
  const explicit = /等待|等到|直到|延迟|稍后继续/.test(source);
  const received = source.match(/^收到(.{1,48}?)后(?:再|就|则)?(.+)$/);
  if (!explicit && !(index > 0 && received)) return null;
  const duration = source.match(/(?:等待|延迟)\s*(\d+(?:\.\d+)?)\s*(秒|分钟|小时|天)/);
  const until = source.match(/(?:等到|直到)\s*((?:20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?\s*)?\d{1,2}[:：]\d{2})/);
  let afterText = "";
  let label = "约定的外部消息";
  let wait: WaitSpec;
  if (duration) {
    const multiplier = duration[2] === "秒" ? 1000 : duration[2] === "分钟" ? 60000 : duration[2] === "小时" ? 3600000 : 86400000;
    label = `等待 ${duration[1]} ${duration[2]}`;
    afterText = clean(source.slice((duration.index || 0) + duration[0].length).replace(/^(?:后|再|就|则)/, ""));
    wait = { mode: "delay", durationMs: Number(duration[1]) * multiplier, eventKey: safeEventKey(label), eventLabel: label, timeoutMs: 0 };
  } else if (until) {
    label = `到 ${until[1]} 继续`;
    afterText = clean(source.slice((until.index || 0) + until[0].length).replace(/^(?:后|再|就|则)/, ""));
    const normalized = until[1].replace(/[年/.]/g, "-").replace(/月/g, "-").replace(/日/g, "").replace("：", ":");
    wait = { mode: "until", until: normalized, eventKey: safeEventKey(label), eventLabel: label, timeoutMs: 0 };
  } else {
    const eventMatch = source.match(/(?:等待|等到|直到)\s*(.+?)(?:后(?:再|就|则)?(.+))?$/) || received;
    label = clean(eventMatch?.[1] || "约定的外部消息").replace(/(?:到达|完成|收到)$/, "") || "约定的外部消息";
    afterText = clean(eventMatch?.[2] || "");
    wait = {
      mode: "event",
      eventKey: safeEventKey(label),
      eventLabel: label,
      payloadSchema: { type: "object" },
      timeoutMs: 24 * 60 * 60 * 1000,
      onTimeoutNext: null,
    };
  }
  const first: ActionItem = {
    title: wait.mode === "event" ? `等待“${label}”后继续` : label,
    type: "wait",
    owner: "系统自动等待",
    evidence: source,
    sourceLabel,
    wait,
  };
  return [first, ...(afterText ? parseActions(afterText, caps, domain, sourceLabel) : [])];
}

interface RecoveryDirective {
  source: string;
  targetHint: string;
  retryCount: number;
  fallbackTasks: ActionItem[];
}

function parseRecoveryDirective(
  raw: string,
  caps: CapabilityRecord[],
  domain: { name?: string } | undefined,
  sourceLabel: string,
): RecoveryDirective | null {
  const source = clean(raw);
  const retryMatch = source.match(
    /^(.{2,54}?)失败(?:时|后)?(?:先)?重试\s*(\d+)\s*次(?:，|,)?(?:(?:仍然?|继续)失败(?:时|后)?)?(?:就|则|改为|改由|转为|转交|转|交给)(.+)$/,
  );
  const simpleMatch = source.match(/^(.{2,54}?)失败(?:时|后)?(?:就|则|改为|改由|转为|转交|转|交给)(.+)$/);
  const match = retryMatch || simpleMatch;
  if (!match) return null;
  const targetHint = clean(match[1]).replace(/^(?:如果|若|当)/, "");
  const fallbackText = clean(retryMatch ? match[3] : match[2]).replace(/^(?:由|给)/, "");
  const retryCount = Math.max(0, Math.min(7, Number(retryMatch ? match[2] : 0)));
  if (!targetHint || !fallbackText) return null;
  let fallbackTasks: ActionItem[];
  const humanFallback = fallbackText.match(/^(.{1,16}?(?:负责人|专员)|人工|管理员)(.*)$/);
  if (humanFallback) {
    const role = clean(humanFallback[1]) || "业务负责人";
    const action = clean(humanFallback[2]) || "接手处理";
    fallbackTasks = [
      {
        title: `${role === "人工" ? "业务负责人" : role}${/确认|审批|复核/.test(action) ? action : `人工${action}`}`,
        type: "human",
        owner: role === "人工" ? "业务负责人" : role,
        evidence: source,
        approval: {
          role: role === "人工" ? "业务负责人" : role,
          reason: `“${targetHint}”持续失败后由员工接手，避免任务无说明中断`,
        },
        sourceLabel,
      },
    ];
  } else {
    fallbackTasks = parseActions(fallbackText, caps, domain, sourceLabel);
  }
  return {
    source,
    targetHint,
    retryCount,
    fallbackTasks: fallbackTasks.length
      ? fallbackTasks
      : [{ title: `备用处理：${fallbackText}`, type: "system", owner: "系统", evidence: source, sourceLabel }],
  };
}

function textTokens(value: string): Set<string> {
  const chunks = clean(value)
    .replace(/失败|异常|执行|处理|进行|步骤|任务/g, "")
    .split(/[\s、，,与和及的：:]+/)
    .filter((item) => item.length >= 2);
  const tokens = new Set(chunks);
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length - 1; index++) tokens.add(chunk.slice(index, index + 2));
  }
  return tokens;
}

function recoveryTarget(nodes: Record<string, BuildNode>, directive: RecoveryDirective): BuildNode | null {
  const hint = textTokens(directive.targetHint);
  const candidates = Object.values(nodes).filter((item) => !["trigger", "end", "rule", "wait", "parallel"].includes(item.type));
  let best: BuildNode | null = null;
  let bestScore = -1;
  for (const item of candidates) {
    const corpus = clean(`${item.title} ${item.description || ""}`);
    const tokens = textTokens(corpus);
    let score = 0;
    for (const token of hint) if (corpus.includes(token)) score += token.length + 2;
    for (const token of tokens) if (directive.targetHint.includes(token)) score += token.length;
    if (item.type === "ai" || item.type === "tool") score += 1;
    if (score >= bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore > 1 ? best : null;
}

interface ParsedConditional {
  conditionText: string;
  actionText: string;
  otherwise: boolean;
}

function parseConditional(raw: string): ParsedConditional | null {
  const value = clean(raw);
  if (/^否则/.test(value)) return { conditionText: "否则", actionText: clean(value.replace(/^否则(?:就|则)?/, "")), otherwise: true };
  let match = value.match(/^(?:如果|若|当)\s*(.+?)[，,]\s*(.+)$/);
  if (!match) match = value.match(/^(?:如果|若|当)\s*(.+?)则\s*(.+)$/);
  if (!match) match = value.match(/^(?:如果|若|当)\s*(.+)时\s*(.+)$/);
  if (!match) {
    match = value.match(
      /^((?:缺少|没有|未发现|资料完整|信息完整|资料不完整|信息不完整|成功|失败|通过|不通过|有风险|无风险)[^，,；;]{0,28}?)时\s*(.+)$/,
    );
  }
  if (!match) match = value.match(/^((?:(?:金额|费用|预算|分数|评分|得分|情绪|语气|优先级|等级)[^，,；;]{1,30}?))时\s*(.+)$/);
  if (!match) return null;
  return { conditionText: clean(match[1]), actionText: clean(match[2]), otherwise: false };
}

function comparatorOperator(token: unknown, fallback = "gt"): string {
  const value = String(token || "").trim();
  if ([">=", "≥"].includes(value) || /不少于|至少|大于等于/.test(value)) return "gte";
  if (["<=", "≤"].includes(value) || /不超过|至多|小于等于/.test(value)) return "lte";
  if ([">"].includes(value) || /超过|大于/.test(value)) return "gt";
  if (["<"].includes(value) || /低于|小于|少于/.test(value)) return "lt";
  if (["=", "=="].includes(value) || /等于|为/.test(value)) return "eq";
  return fallback;
}

function comparatorWord(operator: string): string {
  return operator === "gte" ? "不少于" : operator === "lte" ? "不超过" : operator === "lt" ? "低于" : operator === "eq" ? "等于" : "超过";
}

interface ConditionRule {
  source: string;
  operator: string;
  value?: unknown;
  label?: string;
}

interface ConditionSpec {
  source: string;
  operator: string;
  value: unknown;
  label: string;
  title: string;
  inputHint: string;
  rules?: ConditionRule[];
  mode?: string;
}

function conditionSpec(text: string, allTexts: string[] = []): ConditionSpec {
  const source = clean(text);
  const joined = allTexts.join(" ");
  const compoundParts = source
    .split(/(?:并且|且|同时满足|同时)/)
    .map(clean)
    .filter(Boolean);
  if (compoundParts.length > 1) {
    const specs = compoundParts.map((part) => conditionSpec(part, [part]));
    const useful = specs.filter((spec) => spec.source !== "input.condition" || spec.operator !== "truthy");
    if (useful.length === compoundParts.length) {
      return {
        source: useful[0].source,
        operator: useful[0].operator,
        value: useful[0].value,
        label: source,
        title: `同时满足：${compoundParts.join(" + ")}`,
        inputHint: useful.map((x) => x.inputHint).join(","),
        rules: useful.map((x) => ({ source: x.source, operator: x.operator, value: x.value, label: x.label })),
        mode: "all",
      };
    }
  }
  const purchaseDays = source.match(
    /(?:采购时间|采购周期|计划采购|采购计划|采购天数|周期)[^\d<>≤≥=]{0,10}(>=|<=|>|<|≥|≤|不少于|至少|不超过|小于等于|少于|低于|大于等于|超过|大于)?\s*(\d+(?:\.\d+)?)\s*天(?:内|以内)?/,
  );
  if (purchaseDays) {
    const n = Number(purchaseDays[2]);
    const operator = comparatorOperator(purchaseDays[1], "lte");
    return { source: "input.purchaseDays", operator, value: n, label: source, title: `采购时间${comparatorWord(operator)} ${n} 天吗？`, inputHint: "purchaseDays" };
  }
  if (/邮箱|邮件地址|联系方式/.test(joined) && /(完整|缺少|没有|未)/.test(joined)) {
    return { source: "input.contactComplete", operator: "eq", value: !/缺少|没有|未|不完整/.test(source), label: source, title: "客户联系资料完整吗？", inputHint: "contactComplete" };
  }
  if (/成功|失败/.test(joined)) {
    return { source: "input.isSuccessful", operator: "eq", value: !/失败|未成功/.test(source), label: source, title: "上一步处理成功吗？", inputHint: "isSuccessful" };
  }
  if (/通过|不通过|符合|不符合/.test(joined)) {
    return { source: "input.passed", operator: "eq", value: !/不通过|不符合/.test(source), label: source, title: "符合继续处理的条件吗？", inputHint: "passed" };
  }
  const amount = source.match(
    /(?:金额|费用|预算)\s*(>=|<=|>|<|≥|≤|超过|大于|不少于|至少|大于等于|低于|小于|少于|不超过|小于等于|等于|=)?[^\d]{0,4}\s*([\d,.]+)\s*(万|元)?/,
  );
  if (amount) {
    const n = Number(amount[2].replace(/,/g, "")) * (amount[3] === "万" ? 10000 : 1);
    const operator = comparatorOperator(amount[1], "gt");
    return { source: "input.amount", operator, value: n, label: source, title: `金额${comparatorWord(operator)}${n}元吗？`, inputHint: "amount" };
  }
  const score = source.match(
    /(?:分数|评分|得分)\s*(>=|<=|>|<|≥|≤|超过|大于|不少于|至少|大于等于|低于|小于|少于|不超过|小于等于|等于|=)?[^\d]{0,4}\s*([\d.]+)/,
  );
  if (score) {
    const operator = comparatorOperator(score[1], "gt");
    return { source: "input.score", operator, value: Number(score[2]), label: source, title: `评分${comparatorWord(operator)}${score[2]}吗？`, inputHint: "score" };
  }
  const sentiment = source.match(/(?:情绪|语气)(?:为|是)?\s*(负面|消极|正面|积极|中性)/);
  if (sentiment) {
    return { source: "input.sentiment", operator: "eq", value: sentiment[1], label: source, title: `客户情绪是${sentiment[1]}吗？`, inputHint: "sentiment" };
  }
  const priority = source.match(/(?:优先级|等级)(?:为|是)?\s*(高|中|低|紧急)/);
  if (priority) {
    return { source: "input.priority", operator: "eq", value: priority[1], label: source, title: `任务优先级是${priority[1]}吗？`, inputHint: "priority" };
  }
  if (/风险/.test(joined)) {
    return { source: "input.hasRisk", operator: "eq", value: !/无风险|没有风险|未发现风险/.test(source), label: source, title: "是否发现需要处理的风险？", inputHint: "hasRisk" };
  }
  if (/缺少|没有|未发现|不完整/.test(source)) {
    return { source: "input.hasRequiredData", operator: "eq", value: false, label: source, title: "所需资料齐全吗？", inputHint: "hasRequiredData" };
  }
  if (/完整|齐全|已提供/.test(source)) {
    return { source: "input.hasRequiredData", operator: "eq", value: true, label: source, title: "所需资料齐全吗？", inputHint: "hasRequiredData" };
  }
  return { source: "input.condition", operator: "truthy", value: true, label: source, title: `是否满足：${source}？`, inputHint: "condition" };
}

function needsLongTermMemory(text: string): boolean {
  return /历史|过往|之前|上次|长期|偏好|习惯|记住|持续改进|沿用|常用|经验/.test(String(text || ""));
}

function isHighImpact(task: ActionItem): boolean {
  const action = String(task.tool?.action || "");
  return task.type === "tool" && (task.tool?.risk === "high" || /send_approved|write|update|delete|payment|pay/.test(action));
}

function guardSequence(tasks: ActionItem[], humanReasons: string[] = []): ActionItem[] {
  const output: ActionItem[] = [];
  let approved = false;
  for (let task of tasks) {
    if (task.type === "human") approved = true;
    if (isHighImpact(task) && !approved) {
      output.push({
        title: "业务负责人确认后再继续",
        type: "human",
        owner: "业务负责人",
        evidence: "系统根据高影响动作自动加上的安全确认",
        sourceLabel: "安全边界",
        controlPlane: { kind: "governance", hiddenByDefault: true },
        approval: { role: "业务负责人", reason: humanReasons.join("；") || "对外发送或写回业务系统前需要确认" },
      });
      approved = true;
    }
    if (task.type === "tool" && approved) task = { ...task, tool: { ...task.tool, businessApprovalAccepted: true } as BuildToolSpec };
    output.push(task);
  }
  return output;
}

interface BuildConditionBranch {
  label: string;
  value?: unknown;
  next: string;
  rules?: ConditionRule[];
  mode?: string;
}

interface BuildNode {
  id: string;
  title: string;
  type: string;
  agent: { id: string; name: string; role: string };
  next: string | null;
  description?: string;
  sourceLabel?: string;
  controlPlane?: { kind: string; hiddenByDefault: boolean };
  ui?: { visibility: string };
  modelClass?: string;
  purpose?: string;
  approval?: ActionApproval;
  rejectNext?: string;
  onErrorNext?: string | null;
  retry?: { maxAttempts: number; backoffMs: number };
  tool?: BuildToolSpec | null;
  knowledge?: { space: string; query?: string };
  condition?: { source: string | null; operator: string; branches: BuildConditionBranch[]; defaultNext: string | null };
  inputHint?: string;
  quality?: { requiredOutputTitles: string[]; minOutputCount: number; checkToolReceipts: boolean; checkHumanBoundary: boolean };
  loop?: { collectionPath: string; itemKey: string; maxIterations: number; bodyNext: string | null; exitNext: string | null };
  parallel?: ParallelSpec;
  wait?: WaitSpec;
  memory?: { mode: string; query?: string; limit?: number; contentFrom?: string };
  trigger?: { kind: string; schedule?: string };
}

interface ConditionBranchData {
  label: string;
  spec: ConditionSpec | null;
  otherwise: boolean;
  tasks: ActionItem[];
}

interface ConditionGroup {
  source: string;
  title: string;
  operator: string;
  inputHint: string;
  branches: ConditionBranchData[];
}

function node(
  id: string,
  title: string,
  type: string,
  agent: { id: string; name: string; role: string },
  extra: Partial<BuildNode> = {},
): BuildNode {
  return { id, title: clean(title).slice(0, 58), type, agent, next: null, ...extra };
}

function buildGraph({
  text,
  name,
  domain,
  caps,
  trigger,
  humanReasons = [],
  sourceType = "idea",
}: CompileIntentWorkflowOptions): {
  workflow: Record<string, unknown>;
  orderedSteps: IntentStep[];
  analysis: Record<string, unknown>;
} {
  const capList = (caps ?? []) as CapabilityRecord[];
  const agent = rootAgent(name, domain);
  const sourceLabel = sourceType === "idea" ? "来自你的描述" : "来自上传资料";
  const splitClauses = splitIntentClauses(text);
  const rawClauses: string[] = [];
  for (let i = 0; i < splitClauses.length; i++) {
    const current = splitClauses[i];
    const next = splitClauses[i + 1];
    const parsed = parseConditional(current);
    const standaloneCondition =
      /^(?:如果|若)\s*.+/.test(current) ||
      (/^(?:当)\s*.+/.test(current) && !/(?:收到|上传|提交|新建|创建).{0,30}(?:时|后)?$/.test(current));
    const parsedAction = clean(parsed?.actionText || "");
    const looksLikeRealAction =
      new RegExp(`^(?:${ACTION_WORDS})`).test(parsedAction) || /^(?:由|交给).{1,20}(?:确认|审批|处理)/.test(parsedAction);
    if (standaloneCondition && (!parsed || !looksLikeRealAction) && next && !/^(?:否则|如果|若)/.test(next)) {
      rawClauses.push(`${current}，${next}`);
      i++;
      continue;
    }
    rawClauses.push(current);
  }
  const conditionRows = rawClauses.map(parseConditional).filter((row): row is ParsedConditional => Boolean(row));
  const conditionTexts = conditionRows.filter((row) => !row.otherwise).map((row) => row.conditionText);
  const iterationEnabled =
    /(?:客户|线索|联系人|申请|报销|候选人|记录|订单)/.test(text) &&
    /(?:读取|查询|获取|导入)/.test(text) &&
    /(?:缺少|完整|每个|逐个|分别|分组|分类)/.test(text);
  const prefix: ActionItem[] = [];
  const suffix: ActionItem[] = [];
  const groups: ConditionGroup[] = [];
  const recoveryDirectives: RecoveryDirective[] = [];
  let currentGroup: ConditionGroup | null = null;
  let currentBranch: ConditionBranchData | null = null;
  for (const [clauseIndex, rawClause] of rawClauses.entries()) {
    const recovery = parseRecoveryDirective(rawClause, capList, domain, sourceLabel);
    if (recovery) {
      recoveryDirectives.push(recovery);
      continue;
    }
    const waitTasks = parseWaitTasks(rawClause, capList, domain, sourceLabel, clauseIndex);
    if (waitTasks) {
      prefix.push(...waitTasks);
      continue;
    }
    const parallelTask = parseParallelTask(rawClause, capList, domain, sourceLabel);
    if (parallelTask) {
      prefix.push(parallelTask);
      continue;
    }
    const clause = stripTrigger(rawClause);
    const pureEventTrigger =
      /^(?:当|一旦|收到|上传|提交|新建|创建).{1,80}(?:时|后)$/.test(rawClause) &&
      !/(?:分析|判断|识别|提取|生成|发送|通知|写回|更新|记录|输出|形成)/.test(rawClause);
    if (
      !clause ||
      pureEventTrigger ||
      (clause === rawClause &&
        /^(?:每天|每周|每月|每季度|每年|每个工作日|工作日|定时)/.test(clause) &&
        !new RegExp(ACTION_WORDS).test(clause))
    ) {
      continue;
    }
    const conditional = parseConditional(clause);
    if (conditional) {
      if (conditional.otherwise) {
        if (currentGroup) {
          currentBranch = { label: "否则", otherwise: true, spec: null, tasks: parseActions(conditional.actionText, capList, domain, sourceLabel) };
          currentGroup.branches.push(currentBranch);
        }
        continue;
      }
      let spec = conditionSpec(conditional.conditionText, conditionTexts);
      if (iterationEnabled && spec.source.startsWith("input.")) {
        const field = spec.source.slice(6);
        spec = {
          ...spec,
          source: `context.currentItem.${field}`,
          inputHint: `currentItem.${field}`,
          title: spec.title === "客户联系资料完整吗？" ? "这位客户的联系资料完整吗？" : `这条记录：${spec.title}`,
        };
      }
      if (!currentGroup || currentGroup.source !== spec.source) {
        currentGroup = { source: spec.source, title: spec.title, operator: spec.operator, inputHint: spec.inputHint, branches: [] };
        groups.push(currentGroup);
      }
      currentBranch = { label: spec.label, spec, otherwise: false, tasks: parseActions(conditional.actionText, capList, domain, sourceLabel) };
      currentGroup.branches.push(currentBranch);
      continue;
    }
    const tasks = parseActions(clause, capList, domain, sourceLabel);
    if (!tasks.length) continue;
    if (currentBranch && /^(?:最后|最终|无论|不论|统一)/.test(rawClause)) suffix.push(...tasks);
    else if (currentBranch) currentBranch.tasks.push(...tasks);
    else prefix.push(...tasks);
  }

  const nodes: Record<string, BuildNode> = {};
  const ordered: IntentStep[] = [];
  let sequence = 0;
  nodes.start = node(
    "start",
    (trigger as { value?: string } | undefined)?.value || "收到业务任务",
    "trigger",
    agent,
    (trigger as { schedule?: string } | undefined)?.schedule
      ? { trigger: { kind: "schedule", schedule: (trigger as { schedule?: string }).schedule }, description: "到达设定时间后自动开始" }
      : { description: "收到任务后开始" },
  );
  const memoryEnabled = needsLongTermMemory(text);
  const allTaskCount = prefix.length + groups.reduce((sum, group) => sum + group.branches.reduce((n, branch) => n + branch.tasks.length, 0), 0);
  const addTask = (task: ActionItem, idPrefix = "step"): string => {
    const id = `${idPrefix}_${++sequence}`;
    const extra: Partial<BuildNode> = {
      description: task.evidence,
      sourceLabel: task.sourceLabel,
      ...(task.controlPlane ? { controlPlane: task.controlPlane, ui: { visibility: "control" } } : {}),
      ...(task.type === "ai" ? { modelClass: task.modelClass || "balanced", purpose: task.purpose || "execute" } : {}),
      ...(task.type === "human"
        ? { approval: task.approval || { role: task.owner || "业务负责人", reason: `确认「${task.title}」后继续` }, rejectNext: "not_approved" }
        : {}),
      ...(task.type === "tool" ? { tool: task.tool } : {}),
      ...(task.type === "knowledge" ? { knowledge: task.knowledge } : {}),
      ...(task.type === "parallel" ? { parallel: task.parallel } : {}),
      ...(task.type === "wait" ? { wait: task.wait } : {}),
      ...(task.retry ? { retry: task.retry } : {}),
    };
    nodes[id] = node(id, task.title, task.type, agent, extra);
    ordered.push({
      id: `intent_${ordered.length + 1}`,
      order: ordered.length + 1,
      title: task.title,
      type: task.type,
      owner: task.owner || agent.name,
      toolId: task.tool?.connector || null,
      toolLabel: task.toolLabel || capList.find((cap) => cap.id === task.tool?.connector)?.label || null,
      source: sourceType === "idea" ? "user" : "attachment",
      sourceLabel: task.sourceLabel,
      evidence: task.evidence,
      branch: task.branch || null,
      parallel: task.parallel,
      wait: task.wait,
      retry: task.retry || null,
    });
    return id;
  };

  let head = "start";
  if (memoryEnabled) {
    nodes.memory_read = node("memory_read", "参考过往同类任务", "memory", agent, {
      memory: { mode: "read", query: clean(text).slice(0, 180), limit: 5 },
      description: "只读取当前工作区中这个 Agent 的相关经验",
    });
    nodes[head].next = "memory_read";
    head = "memory_read";
    ordered.push({
      id: `intent_${ordered.length + 1}`,
      order: ordered.length + 1,
      title: "参考过往同类任务",
      type: "memory",
      owner: agent.name,
      toolId: null,
      toolLabel: null,
      source: "system",
      sourceLabel: "根据你的“历史/偏好/经验”要求加入",
      evidence: "运行时检索该 Agent 的相关历史经验",
    });
  }
  const harnessPlanningRequired = allTaskCount >= 4 || groups.length > 0;

  for (const task of guardSequence(prefix, humanReasons)) {
    const id = addTask(task);
    nodes[head].next = id;
    head = id;
  }
  const postQualityTarget = memoryEnabled ? "memory_write" : "done";
  const doneTarget = "quality_review";
  const readNode = Object.values(nodes).find(
    (item) => item.type === "tool" && (item.tool?.action === "read_records" || item.tool?.intentAction === "read_records"),
  );
  const loopId = iterationEnabled && groups.length && readNode ? "loop_1" : null;
  const postConditionJoin = suffix.length ? "post_condition_join" : null;
  if (postConditionJoin) {
    nodes[postConditionJoin] = node(postConditionJoin, "汇合业务分支", "system", agent, {
      description: "仅用于把真实业务分支汇合到共同的最终交付步骤",
    });
  }
  let loopNode: BuildNode & { loop: NonNullable<BuildNode["loop"]> } | null = null;
  if (loopId) {
    loopNode = nodes[loopId] = node(loopId, "逐个处理每条业务记录", "loop", agent, {
      loop: { collectionPath: "context.records", itemKey: "currentItem", maxIterations: 100, bodyNext: null, exitNext: postConditionJoin || doneTarget },
      description: "读取到多条记录时，会逐条判断并执行对应路径",
    }) as BuildNode & { loop: NonNullable<BuildNode["loop"]> };
    nodes[head].next = loopId;
    head = loopId;
    ordered.push({
      id: `intent_${ordered.length + 1}`,
      order: ordered.length + 1,
      title: "逐个处理每条业务记录",
      type: "loop",
      owner: agent.name,
      toolId: null,
      toolLabel: null,
      source: "system",
      sourceLabel: "根据“读取多条记录并分情况处理”加入",
      evidence: "每条记录都独立判断，不会只处理第一条",
    });
  }
  if (!groups.length) {
    nodes[head].next = doneTarget;
  } else {
    groups.forEach((group, index) => {
      const conditionId = `condition_${index + 1}`;
      const conditionNode = (nodes[conditionId] = node(conditionId, group.title, "condition", agent, {
        condition: { source: group.source, operator: group.operator, branches: [], defaultNext: null },
        description: loopId ? "根据当前这条记录选择对应处理路径" : `根据任务输入中的“${group.inputHint}”选择下一条路径`,
        inputHint: group.inputHint,
      })) as BuildNode & { condition: NonNullable<BuildNode["condition"]> };
      if (loopId && index === 0 && loopNode) loopNode.loop.bodyNext = conditionId;
      else nodes[head].next = conditionId;
      ordered.push({
        id: `intent_${ordered.length + 1}`,
        order: ordered.length + 1,
        title: group.title,
        type: "condition",
        owner: "固定条件",
        toolId: null,
        toolLabel: null,
        source: "user",
        sourceLabel,
        evidence: group.branches.map((branch) => branch.label).join(" / "),
      });
      const afterGroup = index === groups.length - 1 ? loopId || postConditionJoin || doneTarget : `join_${index + 1}`;
      if (index < groups.length - 1) {
        nodes[afterGroup] = node(afterGroup, "继续处理下一项条件", "system", agent, { description: "各分支在这里汇合" });
      }
      for (const branch of group.branches) {
        const guarded = guardSequence(
          branch.tasks.map((task) => ({ ...task, branch: branch.label })),
          humanReasons,
        );
        if (!guarded.length) {
          if (branch.otherwise) {
            conditionNode.condition.defaultNext = afterGroup;
          } else if (branch.spec) {
            conditionNode.condition.branches.push({
              label: branch.label,
              value: branch.spec.value,
              next: afterGroup,
              ...(branch.spec.rules ? { rules: branch.spec.rules, mode: branch.spec.mode || "all" } : {}),
            });
          }
          continue;
        }
        let first = "";
        let previous = "";
        for (const task of guarded) {
          const id = addTask(task, "branch");
          if (!first) first = id;
          if (previous) nodes[previous].next = id;
          previous = id;
        }
        nodes[previous].next = afterGroup;
        if (branch.otherwise) {
          conditionNode.condition.defaultNext = first;
        } else if (branch.spec) {
          conditionNode.condition.branches.push({
            label: branch.label,
            value: branch.spec.value,
            next: first,
            ...(branch.spec.rules ? { rules: branch.spec.rules, mode: branch.spec.mode || "all" } : {}),
          });
        }
      }
      if (!conditionNode.condition.defaultNext) conditionNode.condition.defaultNext = afterGroup;
      head = afterGroup;
    });
  }
  if (postConditionJoin) {
    let previous = postConditionJoin;
    for (const task of guardSequence(suffix, humanReasons)) {
      const id = addTask(task, "final");
      nodes[previous].next = id;
      previous = id;
    }
    nodes[previous].next = doneTarget;
  }
  for (const directive of recoveryDirectives) {
    const target = recoveryTarget(nodes, directive);
    if (!target) continue;
    let first = "";
    let previous = "";
    for (const task of directive.fallbackTasks) {
      const id = addTask({ ...task, branch: `${target.title}失败时` }, "recovery");
      if (!first) first = id;
      if (previous) nodes[previous].next = id;
      previous = id;
    }
    if (first) {
      nodes[target.id].onErrorNext = first;
      nodes[target.id].retry = { maxAttempts: Math.max(1, directive.retryCount + 1), backoffMs: 250 };
      nodes[previous].next = doneTarget;
    }
  }
  if (Object.values(nodes).some((item) => item.type === "human")) {
    nodes.not_approved = node(
      "not_approved",
      loopId ? "未获确认，保留本条草稿并继续" : "未获确认，保留草稿并结束",
      "system",
      agent,
      { description: "不会执行后续对外发送、付款或写回动作" },
    );
    nodes.not_approved.next = loopId || doneTarget;
  }
  const qualityOutputs = ordered
    .filter((item) => ["ai", "tool", "knowledge", "parallel"].includes(item.type) && !/^先安排/.test(item.title))
    .map((item) => item.title)
    .slice(0, 12);
  nodes.quality_review = node("quality_review", "交付前检查结果", "rule", agent, {
    quality: {
      requiredOutputTitles: qualityOutputs,
      minOutputCount: qualityOutputs.length ? 1 : 0,
      checkToolReceipts: Object.values(nodes).some((item) => item.type === "tool"),
      checkHumanBoundary: Object.values(nodes).some((item) => item.type === "human"),
    },
    description: "完成前自动核对是否形成结果、业务系统是否有回执，以及重要操作是否经过员工确认",
  });
  nodes.quality_review.next = postQualityTarget;
  ordered.push({
    id: `intent_${ordered.length + 1}`,
    order: ordered.length + 1,
    title: "交付前检查结果",
    type: "rule",
    owner: "系统自动检查",
    toolId: null,
    toolLabel: null,
    source: "system",
    sourceLabel: "根据完整闭环要求加入",
    evidence: "没有结果或缺少业务系统回执时不会直接标记完成",
  });
  if (memoryEnabled) {
    nodes.memory_write = node("memory_write", "保存本次可复用经验", "memory", agent, {
      memory: { mode: "write", contentFrom: "run_summary" },
      description: "保存结果与人工决定，供后续同类任务参考",
    });
    nodes.memory_write.next = "done";
    ordered.push({
      id: `intent_${ordered.length + 1}`,
      order: ordered.length + 1,
      title: "保存本次可复用经验",
      type: "memory",
      owner: agent.name,
      toolId: null,
      toolLabel: null,
      source: "system",
      sourceLabel: "根据你的“历史/偏好/经验”要求加入",
      evidence: "任务结束前保存结果和人工决定",
    });
  }
  nodes.done = node("done", "本次任务已完成", "end", agent, { description: "结果、执行记录与人工决定均已保存" });
  return {
    workflow: {
      id: `WF-${randomUUID()}`,
      versionId: null,
      startNodeId: "start",
      rootAgent: agent,
      nodes,
      variables: [],
      memoryPolicy: {
        taskContext: true,
        longTerm: memoryEnabled,
        description: memoryEnabled ? "会参考并保存同类任务经验" : "仅保留本次任务所需信息",
      },
      intentSource: {
        mode: "semantic-graph-v3.6",
        schema: "intent-contract/v3.6",
        clauses: rawClauses,
        conditionCount: groups.length,
        parallelCount: Object.values(nodes).filter((item) => item.type === "parallel").length,
        waitCount: Object.values(nodes).filter((item) => item.type === "wait").length,
        recoveryRouteCount: Object.values(nodes).filter((item) => item.onErrorNext).length,
        collectionLoop: !!loopId,
        dynamicToolBinding: capList.some((cap) => cap.source === "connected-registry"),
        qualityGate: true,
        harnessPlanningRequired,
      },
    },
    orderedSteps: ordered,
    analysis: {
      schema: "local-complex-intent/v3.6",
      clauses: rawClauses,
      conditionGroups: groups.map((group) => ({
        title: group.title,
        source: group.source,
        branches: group.branches.map((branch) => branch.label),
      })),
      usesPlanning: harnessPlanningRequired,
      usesParallel: Object.values(nodes).some((item) => item.type === "parallel"),
      usesDurableWait: Object.values(nodes).some((item) => item.type === "wait"),
      usesRecovery: Object.values(nodes).some((item) => item.onErrorNext),
      usesLongTermMemory: memoryEnabled,
      usesCollectionLoop: !!loopId,
      usesQualityGate: true,
      dynamicToolBindings: capList
        .filter((cap) => cap.source === "connected-registry")
        .map((cap) => ({ toolId: cap.registryToolId, title: cap.label, scope: cap.scope })),
      inputHints: uniq(groups.map((group) => group.inputHint)),
    },
  };
}

export function compileIntentWorkflow(options: CompileIntentWorkflowOptions): {
  workflow: WorkflowDraft;
  orderedSteps: IntentStep[];
  analysis: Record<string, unknown>;
} {
  const built = buildGraph(options);
  // 仅校验不替换：Zod 解析会补默认值并剥离旧遗留字段，直接返回解析结果会破坏金测对齐
  WorkflowDraft.parse(built.workflow);
  return {
    workflow: built.workflow as unknown as WorkflowDraft,
    orderedSteps: built.orderedSteps,
    analysis: built.analysis,
  };
}
