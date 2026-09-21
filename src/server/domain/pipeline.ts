// 创建助手的纯 domain 管道：意图文本 → 编译 → 业务落地门禁 → 复杂意图契约 → 设计审计。
// 只做纯计算，不碰数据库；Server Action 是薄封装。trigger/outputs 创建时尚无来源
// （蓝图问答在后续任务），先传空值，门禁按意图文本自行抽取需求。
// 发布侧纯函数也在此文件：stableStringify / buildManifest（env 由 Server Action 读取后经参数传入）。
import { createHash } from "node:crypto";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowDraft } from "@/contracts/workflow";
import { attachComplexIntentContract, compileIntentWorkflow } from "@/server/domain/intent";
import { groundBusinessWorkflow } from "@/server/domain/grounding";
import { auditWorkflow, type AuditIssue, type DesignAuditResult } from "@/server/domain/audit";

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

export function buildAgentDraft(options: { name: string; intentText: string }): AgentPipelineResult {
  const { name, intentText } = options;
  try {
    const compiled = compileIntentWorkflow({ text: intentText, name, caps: [], humanReasons: [], sourceType: "idea" });
    const intent = { orderedSteps: compiled.orderedSteps, trigger: undefined, outputs: [] };
    const grounded = groundBusinessWorkflow(compiled.workflow, {
      sourceText: intentText,
      intent,
      answers: {},
    });
    const enriched = attachComplexIntentContract(grounded, intent, intentText);
    // parse 在此补全默认值并把形状收敛到契约——入库与后续画布都消费契约形状，不落原始结构
    const draft = WorkflowDraft.parse(enriched);
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

// M1 简化：统一一个业务输入字段，条件节点引用 input.* 时按前缀后的路径列出具体字段
// （取名字段的语义与旧系统 workflowTestContract.mjs sourceField 一致）
function inputContractFor(draft: WorkflowDraft): AgentManifest["inputContract"] {
  const fields: AgentManifest["inputContract"]["fields"] = [{ name: "input", label: "业务输入", required: true, type: "string" }];
  const seen = new Set(["input"]);
  for (const node of Object.values(draft.nodes)) {
    if (node.type !== "condition" || !node.condition) continue;
    const sources = [node.condition.source, ...node.condition.branches.flatMap((branch) => (branch.rules ?? []).map((rule) => rule.source))].filter(
      (source): source is string => typeof source === "string" && source.startsWith("input."),
    );
    for (const source of sources) {
      const name = source.slice("input.".length).split(".")[0];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      fields.push({ name, required: true, type: "string" });
    }
  }
  return { fields };
}

export function buildManifest(draft: WorkflowDraft, options: { modelId: string; mock: boolean }): AgentManifest {
  const audit = auditWorkflow(draft);
  return AgentManifest.parse({
    schemaVersion: "4.0",
    workflowSnapshot: draft,
    workflowFingerprint: createHash("sha256").update(stableStringify(draft)).digest("hex"),
    inputContract: inputContractFor(draft),
    outputContract: draft.outputContract ?? { fields: [] },
    requirementCoverage: asRecord(audit.requirementCoverage),
    complexityProfile: asRecord(audit.complexityProfile),
    resourceSelection: { model: { modelId: options.modelId, mock: options.mock } },
    designAudit: {
      status: deriveDesignAuditStatus(audit.counts),
      issueCount: audit.issues.length,
      criticalCount: audit.counts.critical,
    },
  });
}
