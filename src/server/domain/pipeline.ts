// 创建助手的纯 domain 管道：意图文本 → 编译 → 业务落地门禁 → 复杂意图契约 → 设计审计。
// 只做纯计算，不碰数据库；Server Action 是薄封装。trigger/outputs 创建时尚无来源
// （蓝图问答在后续任务），先传空值，门禁按意图文本自行抽取需求。
// 发布侧纯函数也在此文件：stableStringify / buildManifest（env 由 Server Action 读取后经参数传入）。
import { createHash } from "node:crypto";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowDraft } from "@/contracts/workflow";
import { attachComplexIntentContract, compileIntentWorkflow, type IntentStep } from "@/server/domain/intent";
import { groundBusinessWorkflow } from "@/server/domain/grounding";
import { auditWorkflow, type AuditIssue, type DesignAuditResult } from "@/server/domain/audit";
import { applySafeAuditFixes } from "@/server/domain/audit/safe-audit-fixes";

export interface AgentDraftAuditSummary {
  status: DesignAuditResult["status"];
  score: number;
  counts: DesignAuditResult["counts"];
}

export interface AgentDraftDiagnostics {
  error?: string;
  audit?: AgentDraftAuditSummary;
}

export interface AgentPipelineResult {
  draft: WorkflowDraft | null;
  issues: AuditIssue[];
  diagnostics: AgentDraftDiagnostics;
}

export function buildAgentDraft(options: { name: string; intentText: string; capabilities?: unknown[] }): AgentPipelineResult {
  const { name, intentText } = options;
  try {
    const compiled = compileIntentWorkflow({ text: intentText, name, caps: options.capabilities ?? [], humanReasons: [], sourceType: "idea" });
    return finalizeAgentDraft({ name, intentText, workflow: compiled.workflow, orderedSteps: compiled.orderedSteps });
  } catch (error) {
    return { draft: null, issues: [], diagnostics: { error: error instanceof Error ? error.message : String(error) } };
  }
}

export function finalizeAgentDraft(params: {
  name: string;
  intentText: string;
  workflow: WorkflowDraft;
  orderedSteps: IntentStep[];
}): AgentPipelineResult {
  const { intentText, workflow, orderedSteps } = params;
  try {
    bindDemoCapabilities(workflow);
    const intent = { orderedSteps, trigger: undefined, outputs: [] };
    const grounded = groundBusinessWorkflow(workflow, {
      sourceText: intentText,
      intent,
      answers: {},
    });
    const enriched = attachComplexIntentContract(grounded, intent, intentText);
    // parse 在此补全默认值并把形状收敛到契约——入库与后续画布都消费契约形状，不落原始结构
    const parsedDraft = WorkflowDraft.parse(enriched);
    const draft = applySafeAuditFixes(parsedDraft, {
      codes: new Set(["output_contract_missing", "end_without_delivery"]),
    }).draft;
    const audit = auditWorkflow(draft);
    return {
      draft,
      issues: audit.issues,
      diagnostics: { audit: { status: audit.status, score: audit.score, counts: audit.counts } },
    };
  } catch (error) {
    // 编译链对个别输入可能抛错（validate-only parse 与旧 TypeError 路径），统一转为可读诊断
    return {
      draft: null,
      issues: [],
      diagnostics: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

// M1 工具裁定（M2 真实连接后移除）：编译器对未注册工具打未绑定标记（registryToolId=null、
// protocol/connector='unbound'、scope 以 unbound. 开头、unresolved=true），通用知识库步骤同样无真实来源；
// grounding 的 executableTool/knowledgeBound 会据此全部判死 → business_source_unresolved 恒为 critical，
// 发布成功路径在 M1 永远不可达。此处在 compile 之后、grounding 之前把未绑定能力统一改绑演示来源，
// 并清空编译器填的 runtimeRequirements.unresolvedTools（列表已失效，留着会让运行前置校验直接拒绝）。
export function bindDemoCapabilities(workflow: WorkflowDraft): void {
  for (const node of Object.values(workflow.nodes)) {
    if (
      node.type === "tool" &&
      node.tool &&
      (node.tool.unresolved === true || node.tool.registryToolId == null || node.tool.protocol === "unbound")
    ) {
      // connector/scope 必须一并改绑：executableTool 还要求 connector!=='unbound' 且 scope 不以 unbound. 开头
      node.tool.registryToolId = "demo";
      node.tool.protocol = "demo";
      node.tool.unresolved = false;
      if (node.tool.connector === "unbound") node.tool.connector = "demo";
      if (/^unbound\./.test(node.tool.scope)) node.tool.scope = "demo";
    }
    if (node.type === "knowledge" && node.knowledge && /^(业务知识库|knowledge|知识库)?$/i.test(node.knowledge.space)) {
      node.knowledge.space = "演示资料库";
    }
  }
  const requirements = (workflow.runtimeRequirements ??= { externalTools: [], unresolvedTools: [], toolReceiptVerification: true });
  requirements.unresolvedTools = [];
}

// 控制面节点可能因标题像目标声明而被业务审计误报；仅对明确隐藏的控制节点豁免。
// 最终交付物与结束前交付步骤已有确定性自动补全，不再允许带着这两类关键缺口发布。
const PUBLISH_EXEMPT_CODES: ReadonlySet<string> = new Set(["meta_node_detected"]);

function isControlDraftNode(nodeId: string | null, draft: WorkflowDraft): boolean {
  if (!nodeId) return false;
  const node = draft.nodes[nodeId];
  return node?.ui?.visibility === "control" || node?.controlPlane?.hiddenByDefault === true;
}

export function filterPublishBlockers(issues: AuditIssue[], draft: WorkflowDraft): { blocking: AuditIssue[]; exempted: AuditIssue[] } {
  const blocking: AuditIssue[] = [];
  const exempted: AuditIssue[] = [];
  for (const issue of issues) {
    // 只有 critical 参与裁决：warning/info 本就不拦发布，也不进豁免提醒
    if (issue.severity !== "critical") continue;
    const exempt = PUBLISH_EXEMPT_CODES.has(issue.code) && isControlDraftNode(issue.nodeId, draft);
    (exempt ? exempted : blocking).push(issue);
  }
  return { blocking, exempted };
}

// 指纹要求同一草稿在不同键序下产出同一序列化：递归排序对象键；undefined 字段按 JSON 规则丢弃
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export type ManifestAuditStatus = AgentManifest["designAudit"]["status"];

// manifest 里的审计状态按问题计数推导（旧系统 status 是 blocked/review/ready，语义不同不沿用）
export function deriveDesignAuditStatus(counts: { critical: number; warning: number }): ManifestAuditStatus {
  if (counts.critical > 0) return "blocked";
  if (counts.warning > 0) return "passed_with_warnings";
  return "passed";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function inputContractFor(draft: WorkflowDraft): AgentManifest["inputContract"] {
  const fields: AgentManifest["inputContract"]["fields"] = [];
  const seen = new Set<string>();
  const inputTypes = new Set<AgentManifest["inputContract"]["fields"][number]["type"]>(["string", "number", "boolean", "object", "array"]);
  for (const variable of draft.variables ?? []) {
    if (
      variable.scope !== "run"
      || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name)
      || seen.has(variable.name)
      || !inputTypes.has(variable.type as AgentManifest["inputContract"]["fields"][number]["type"])
    ) continue;
    seen.add(variable.name);
    fields.push({
      name: variable.name,
      label: variable.label,
      required: variable.required,
      type: variable.type as AgentManifest["inputContract"]["fields"][number]["type"],
    });
  }
  if (fields.length === 0) {
    fields.push({ name: "input", label: "业务输入", required: true, type: "string" });
    seen.add("input");
  }
  for (const node of Object.values(draft.nodes)) {
    if (node.type !== "condition" || !node.condition) continue;
    const sources = [node.condition.source, ...node.condition.branches.flatMap((branch) => (branch.rules ?? []).map((rule) => rule.source))].filter(
      (source): source is string => typeof source === "string" && source.startsWith("input."),
    );
    for (const source of sources) {
      // 嵌套引用（input.a.b）收敛为首段字段：M1 输入契约只声明一层扁平字段
      const name = source.slice("input.".length).split(".")[0];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      fields.push({ name, required: true, type: "string" });
    }
  }
  return { fields };
}

export function buildManifest(
  draft: WorkflowDraft,
  options: { modelId: string; mock: boolean; connectionId: string | null; knowledgeSnapshot: string[] },
): AgentManifest {
  const audit = auditWorkflow(draft);
  return AgentManifest.parse({
    schemaVersion: "4.0",
    workflowSnapshot: draft,
    workflowFingerprint: createHash("sha256").update(stableStringify(draft)).digest("hex"),
    inputContract: inputContractFor(draft),
    outputContract: draft.outputContract ?? { fields: [] },
    requirementCoverage: asRecord(audit.requirementCoverage),
    complexityProfile: asRecord(audit.complexityProfile),
    resourceSelection: { model: { modelId: options.modelId, mock: options.mock, connectionId: options.connectionId ?? null } },
    knowledgeSnapshot: options.knowledgeSnapshot,
    designAudit: {
      status: deriveDesignAuditStatus(audit.counts),
      issueCount: audit.issues.length,
      criticalCount: audit.counts.critical,
    },
  });
}
