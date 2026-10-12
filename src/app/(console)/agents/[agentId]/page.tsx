import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AgentMetadataEditor } from "@/features/agents/AgentMetadataEditor";
import { evaluationReviewNavigation } from "@/features/agents/evaluation-review-navigation";
import { agentScheduleHref } from "@/features/schedules/agent-schedule-scope";
import { DesignAuditPanel } from "@/features/agents/DesignAuditPanel";
import { AgentWorkspaceSummaryCard, loadAgentWorkspaceSections } from "@/features/agents/AgentWorkspaceSections";
import { SectionReadState } from "@/components/ui/SectionReadState";
import { SectionLoadingState } from "@/components/ui/SectionLoadingState";
import { AuditIssueView } from "@/contracts/audit";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { auditWorkflow, type DesignAuditResult } from "@/server/domain/audit";
import { getAgentDetail } from "@/server/queries/agents";
import { pageFromSearchParam } from "@/lib/search-params";
import { withSafeQueryError } from "@/server/security/query-error";
import { z } from "zod";
import { Download, ArrowLeft, CheckCircle2, FlaskConical, Layers3, Play, Rocket, ShieldCheck, Workflow } from "lucide-react";

export const dynamic = "force-dynamic";

// 审计摘要仅服务端渲染，不把内部审计对象传给客户端。
function auditStatusLine(audit: DesignAuditResult | null): string {
  if (!audit) return "设计检查：暂时无法获取";
  if (audit.status === "blocked") return "设计检查：未通过（" + audit.counts.critical + " 个阻塞）";
  if (audit.status === "review") return "设计检查：待复核（" + (audit.counts.warning + audit.counts.info) + " 个建议）";
  return "设计检查：通过";
}

export default async function AgentDetailPage({
  params, searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agentId } = await params;
  if (!z.string().uuid().safeParse(agentId).success) notFound();
  const query = await searchParams;
  const review = evaluationReviewNavigation(query);
  const detail = await withSafeQueryError(() => getAgentDetail(agentId, DEMO_WORKSPACE_ID), "agent-detail");
  if (!detail) notFound();
  const audit = detail.draft ? auditWorkflow(detail.draft) : null;
  const sections = loadAgentWorkspaceSections(detail, {
    versionPage: pageFromSearchParam(query.versionsPage),
    archivedCasesPage: pageFromSearchParam(query.archivedCasesPage),
    evaluationRunsPage: pageFromSearchParam(query.evaluationRunsPage),
    reviewNavigation: review.state, invalidReviewNavigation: review.invalid,
  });
  const navigation = [
    { href: "#workflow", label: "流程设计", icon: Workflow },
    { href: "#audit", label: "设计检查", icon: ShieldCheck },
    { href: "#versions", label: "版本发布", icon: Rocket },
    { href: "#evaluation", label: "自动验收", icon: FlaskConical },
    { href: "#run", label: "试运行", icon: Play },
  ];
  return <main className="page-shell max-w-[1480px]">
    <Link href="/agents" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />返回助手列表</Link>
    <header className="content-card flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="eyebrow mb-2">助手工作台</p><h1 className="text-2xl font-bold tracking-tight text-slate-950">{detail.agent.name}</h1></div>
        <div className="flex flex-wrap gap-2"><Link href={agentScheduleHref(detail.agent.id)!} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">管理此助手的定时任务</Link><a href={"/api/agents/" + agentId + "/export"} download className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"><Download className="size-4" />导出定义</a></div>
      </div>
      {detail.agent.description ? <p className="text-sm text-gray-500">{detail.agent.description}</p> : null}
      <AgentMetadataEditor key={agentId} agentId={agentId} initialName={detail.agent.name} initialDescription={detail.agent.description} initialUpdatedAt={detail.agent.updatedAt.toISOString()} />
      <p className="w-fit rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">{auditStatusLine(audit)}</p>
    </header>
    <section aria-label="助手状态摘要" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <AgentWorkspaceSummaryCard title={detail.draft ? "流程步骤" : "流程步骤 · 草稿不可用"} value={detail.draft ? Object.keys(detail.draft.nodes).length : "—"} icon={Layers3} tone="bg-indigo-50 text-indigo-600" />
      <Suspense key={"version-summary:" + agentId} fallback={<AgentWorkspaceSummaryCard title="当前版本 · 正在核对" value={detail.currentVersion ? "已发布" : "未发布"} icon={Rocket} tone="bg-blue-50 text-blue-600" />}>{sections.versionSummary}</Suspense>
      <Suspense key={"case-summary:" + agentId} fallback={<AgentWorkspaceSummaryCard title="启用样例 · 正在读取" value="—" icon={CheckCircle2} tone="bg-emerald-50 text-emerald-600" />}>{sections.caseSummary}</Suspense>
      <AgentWorkspaceSummaryCard title="设计得分" value={audit?.score ?? "—"} icon={ShieldCheck} tone="bg-amber-50 text-amber-600" />
    </section>
    <nav aria-label="助手工作台分区" className="sticky top-14 z-30 -mx-1 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-sm backdrop-blur">
      {navigation.map(({ href, label, icon: Icon }) => <a key={href} href={href} className="inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"><Icon className="size-4" />{label}</a>)}
    </nav>
    <section id="workflow" className="scroll-mt-32">
      <Suspense key={"workflow:" + agentId} fallback={<SectionLoadingState id="workflow-loading" title="正在读取流程资源" description="正在核对资料、工具和协作助手。核对完成前不开放画布编辑，已保存草稿没有改动。" className="min-h-[560px]" />}>{sections.workflow}</Suspense>
    </section>
    {audit ? <DesignAuditPanel key={agentId} agentId={agentId} score={audit.score} issues={AuditIssueView.array().parse(audit.issues)} /> : <SectionReadState id="audit" title="设计检查暂时无法进行" description="没有有效流程草稿可供检查，当前不能判断设计是否通过。重新读取草稿后再核对；已发布版本和已有运行不会因此被改动。" />}
    <Suspense key={"publication:" + agentId} fallback={<SectionLoadingState id="versions" title="正在读取版本发布" description="正在核对版本历史和模型连接。读取完成前不开放发布或恢复，不会改变当前版本。" />}>{sections.publication}</Suspense>
    <Suspense key={"evaluation:" + agentId} fallback={<SectionLoadingState id="evaluation" title="正在读取自动验收" description="正在核对样例、运行记录和目标版本字段。读取完成前不开放样例修改或新一轮验收，已有任务不会停止。" />}>{sections.evaluation}</Suspense>
    <Suspense key={"launcher:" + agentId} fallback={<SectionLoadingState id="run" title="正在核对试运行版本" description="正在核对当前正式版本编号。不启动运行，也不使用当前草稿代替正式版本。" />}>{sections.launcher}</Suspense>
  </main>;
}
