// 创建助手的纯 domain 管道：意图文本 → 编译 → 业务落地门禁 → 复杂意图契约 → 设计审计。
// 只做纯计算，不碰数据库；Server Action 是薄封装。trigger/outputs 创建时尚无来源
// （蓝图问答在后续任务），先传空值，门禁按意图文本自行抽取需求。
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
