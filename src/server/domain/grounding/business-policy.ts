// 旧系统 server/businessPolicyV57.mjs 的逐行移植（禁止指令归一化 + 运行时业务策略门禁）。
// 裁定 1：forbiddenActionMatch 签名以旧代码为准——(node, directives)，node 拼 title/description/
// tool/businessSpec 等语料，返回匹配对象而非 boolean（简报 Produces 行为计划文本失真）。
// 裁定 2：runtimeBusinessPolicyDecision 为简报 Produces 清单遗漏项，Task 11 运行引擎 rule 节点消费。

export interface PolicyNode {
  [key: string]: unknown;
  id?: string;
  title?: string;
  description?: string;
  tool?: { scope?: string; action?: string; intentAction?: string } | null;
  operation?: { kind?: string } | null;
  system?: { kind?: string } | null;
  businessSpec?: { objective?: string; rules?: string[]; [key: string]: unknown } | null;
}

export interface PolicyWorkflow {
  [key: string]: unknown;
  businessPolicies?: { forbiddenActions?: string[] } | null;
}

export interface ForbiddenActionMatch {
  matched: boolean;
  directive: string | null;
  actionFamilies: string[];
  objectFamilies: string[];
  nodeText: string;
}

export interface RuntimeBusinessPolicyDecision {
  allowed: boolean;
  code: "forbidden_business_action" | "allowed";
  reason: string;
  match?: ForbiddenActionMatch;
}

const NEGATIVE_PREFIX =
  /^(?:不要|无需|无须|禁止|不得|不允许|不需要|避免|不能|不可|不(?=(?:写回|发送|发邮件|邮件|更新|删除|创建|通知|支付|付款|发布)))/;

const ACTION_FAMILIES = [
  { id: "send", re: /(发送|发出|通知|提醒|推送|群发|邮件|短信|消息)/ },
  { id: "write", re: /(写回|更新|修改|写入|同步|保存到|登记到)/ },
  { id: "delete", re: /(删除|清空|移除|作废)/ },
  { id: "create", re: /(创建|新建|新增|提交|发起)/ },
  { id: "pay", re: /(付款|支付|转账|扣款|下单)/ },
  { id: "publish", re: /(发布|公开|上线|对外展示)/ },
];

const OBJECT_FAMILIES = [
  { id: "mail", re: /(邮件|邮箱|email|mail)/i },
  { id: "crm", re: /(crm|客户系统|客户关系)/i },
  { id: "message", re: /(消息|短信|飞书|企业微信|微信|slack|teams)/i },
  { id: "finance", re: /(付款|支付|转账|财务|账单|发票)/i },
  { id: "document", re: /(文档|文件|表格|知识库)/i },
  { id: "data", re: /(数据|记录|字段|数据库)/i },
];

function clean(value: unknown): string {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values: (string | null | undefined)[] | null | undefined): string[] {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

export function splitForbiddenDirectives(value = ""): string[] {
  const text = clean(value);
  if (!text) return [];
  const pieces = text
    .split(/[，,、；;]+/)
    .map(clean)
    .filter(Boolean);
  const out: string[] = [];
  let inherited = "";
  for (const part of pieces) {
    const matched = part.match(NEGATIVE_PREFIX);
    if (matched) {
      inherited = matched[0];
      out.push(part);
      continue;
    }
    if (inherited && part) out.push(`${inherited}${part}`);
  }
  if (!out.length && NEGATIVE_PREFIX.test(text)) out.push(text);
  return uniq(out);
}

export function normalizeForbiddenActions(values: string[] | string = []): string[] {
  return uniq((Array.isArray(values) ? values : [values]).flatMap((item) => splitForbiddenDirectives(item)));
}

function nodeText(node: PolicyNode = {}): string {
  return clean(
    [
      node.title,
      node.description,
      node.tool?.scope,
      node.tool?.action,
      node.tool?.intentAction,
      node.operation?.kind,
      node.system?.kind,
      node.businessSpec?.objective,
      ...(node.businessSpec?.rules || []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function signature(text = ""): { actions: string[]; objects: string[] } {
  return {
    actions: ACTION_FAMILIES.filter((item) => item.re.test(text)).map((item) => item.id),
    objects: OBJECT_FAMILIES.filter((item) => item.re.test(text)).map((item) => item.id),
  };
}

export function forbiddenActionMatch(node: PolicyNode = {}, directives: string[] = []): ForbiddenActionMatch {
  const corpus = nodeText(node);
  const nodeSig = signature(corpus);
  for (const directive of normalizeForbiddenActions(directives)) {
    const sig = signature(directive);
    const actionHit = sig.actions.length ? sig.actions.some((item) => nodeSig.actions.includes(item)) : false;
    const objectHit = sig.objects.length ? sig.objects.some((item) => nodeSig.objects.includes(item)) : true;
    if (actionHit && objectHit) {
      return { matched: true, directive, actionFamilies: sig.actions, objectFamilies: sig.objects, nodeText: corpus };
    }
  }
  return { matched: false, directive: null, actionFamilies: [], objectFamilies: [], nodeText: corpus };
}

export function runtimeBusinessPolicyDecision(
  workflow: PolicyWorkflow | null | undefined,
  node: PolicyNode,
): RuntimeBusinessPolicyDecision {
  const match = forbiddenActionMatch(node, workflow?.businessPolicies?.forbiddenActions || []);
  return match.matched
    ? {
        allowed: false,
        code: "forbidden_business_action",
        reason: `用户明确要求“${match.directive}”，当前步骤“${node?.title || node?.id}”与该禁止项冲突。`,
        match,
      }
    : { allowed: true, code: "allowed", reason: "未命中用户明确禁止项" };
}
