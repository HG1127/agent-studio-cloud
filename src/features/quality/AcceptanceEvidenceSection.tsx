import Link from "next/link";
import type { AgentSummary } from "@/contracts/agent";
import type { EvaluationRunView } from "@/contracts/evaluation";
import { EvaluationHistory } from "@/features/agents/EvaluationHistory";
import { EvaluationReviewNavigation, evaluationReviewHref } from "@/features/agents/evaluation-review-navigation";
import { acceptanceOverviewHref, type AcceptanceEvidenceSelection, type AcceptanceOverviewScope } from "./acceptance-evidence-navigation";

export function AcceptanceEvidenceSection({ agent, latest, selection, overview }: {
  agent: Pick<AgentSummary, "id" | "name">; latest: EvaluationRunView;
  selection: AcceptanceEvidenceSelection; overview: AcceptanceOverviewScope;
}) {
  const navigation = EvaluationReviewNavigation.parse({
    batchId: selection.batchId, caseId: selection.caseId, query: selection.query, status: selection.status, samplePage: selection.samplePage,
  });
  return <section id="evidence" aria-label={`${agent.name}的验收证据`} className="content-card scroll-mt-32 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="section-title break-words">{agent.name} · 核对这轮验收</h2><p className="mt-2 text-sm leading-6 text-slate-500">本页仅展示这位助手最近一轮已读取的记录。筛选和核对不会修改判定；已有新一轮时，不会替换当前所选批次。</p></div><Link prefetch={false} scroll={false} href={acceptanceOverviewHref(overview)} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">收起证据核对</Link></div>
    <EvaluationHistory key={agent.id} agentId={agent.id} runs={[latest]} navigation={navigation} overviewScope={overview} />
    <Link prefetch={false} href={evaluationReviewHref(agent.id, navigation)} className="inline-flex text-sm font-semibold text-indigo-700">到助手工作台查看完整验收历史</Link>
  </section>;
}
