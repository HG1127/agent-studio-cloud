import Link from "next/link";
import { ArrowLeft, CircleAlert, Clock3, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { SectionReadState } from "@/components/ui/SectionReadState";
import { RunAttentionSection, ATTENTION_PAGE_SIZE } from "@/features/runs/RunAttentionSection";
import { RunFilters } from "@/features/runs/RunFilters";
import { attentionStateFromSearch } from "@/features/runs/run-attention-url";
import { toolOperationsHref } from "@/features/tool-operations/tool-operation-navigation";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { listRunAgentOptions, listRuns } from "@/server/queries/runs";
import { withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

export default async function RunAttentionPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = attentionStateFromSearch(await searchParams);
  if (!parsed.success) return <main className="page-shell">
    <PageHeader eyebrow="任务与执行" title="待处理任务" description="集中核对等待确认、等待继续和失败记录。" />
    <section className="content-card"><p role="alert" className="text-sm text-amber-900">筛选条件无效，尚未读取任务。请清除筛选后重新选择查看范围。</p><Link href="/runs/attention" className="mt-4 inline-flex text-sm font-semibold text-indigo-700">清除无效筛选</Link></section>
  </main>;
  const state = parsed.data;
  const filters = { sourceType: state.sourceType, agentId: state.agentId };
  const [approval, event, failed, agents] = await Promise.allSettled([
    withSafeQueryError(() => listRuns(DEMO_WORKSPACE_ID, { ...filters, status: "waiting_approval" }, { limit: ATTENTION_PAGE_SIZE + 1, offset: (state.approvalPage - 1) * ATTENTION_PAGE_SIZE }), "attention-approval"),
    withSafeQueryError(() => listRuns(DEMO_WORKSPACE_ID, { ...filters, status: "waiting_event" }, { limit: ATTENTION_PAGE_SIZE + 1, offset: (state.eventPage - 1) * ATTENTION_PAGE_SIZE }), "attention-event"),
    withSafeQueryError(() => listRuns(DEMO_WORKSPACE_ID, { ...filters, status: "failed" }, { limit: ATTENTION_PAGE_SIZE + 1, offset: (state.failedPage - 1) * ATTENTION_PAGE_SIZE }), "attention-failed"),
    withSafeQueryError(() => listRunAgentOptions(DEMO_WORKSPACE_ID), "attention-agent-options"),
  ]);
  return <main className="page-shell">
    <PageHeader eyebrow="任务与执行" title="待处理任务" description="先核对确认事项，再查看等待原因与失败证据。进入详情后按最新记录操作，这里不批量批准或重新执行。"
      action={<div className="flex flex-wrap gap-2"><PageRefreshButton /><Link href="/runs" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeft aria-hidden="true" className="size-4" />全部运行记录</Link></div>} />
    <nav aria-label="待处理分类" className="grid gap-3 lg:grid-cols-3">
      {[{ id: "attention-approval", title: "等待确认或恢复", detail: "核对待决定事项与已保存决定", icon: ShieldCheck }, { id: "attention-event", title: "等待继续", detail: "先确认等待的是消息还是时间", icon: Clock3 }, { id: "attention-failed", title: "失败待核对", detail: "查看原因，再决定是否重试", icon: CircleAlert }].map(({ id, title, detail, icon: Icon }) => <Link key={id} href={`#${id}`} className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:bg-indigo-50/40"><Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-indigo-600" /><span className="min-w-0"><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{detail}</span></span></Link>)}
    </nav>
    <p className="text-xs leading-5 text-slate-500">按当前工作区的实际运行状态分类，不是个人分派或审批权限清单。每类独立翻页，数量只表示本页；状态变化后可手动重新读取。</p>
    <aside aria-label="业务工具结果核对入口" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4"><div><h2 className="text-sm font-semibold text-slate-900">业务工具结果不确定？</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">先查询实际业务系统，再登记核对依据与回执。此入口查看工作区的待核对工具记录，不沿用下方助手或发起方式筛选，也不自动恢复旧任务。</p></div><Link href={toolOperationsHref({ status: "blocked", limit: 20 })} className="inline-flex shrink-0 text-sm font-semibold text-indigo-700 hover:underline">查看待核对的业务工具</Link></aside>
    {agents.status === "rejected" ? <SectionReadState id="attention-agents" title="助手选项暂时无法读取" description="已选助手范围仍保留，暂不能切换助手。发起方式筛选和已读取的任务仍可使用。" /> : null}
    <section className="content-card"><RunFilters filters={filters} agents={agents.status === "fulfilled" ? agents.value : []} action="/runs/attention" showStatus={false} agentsUnavailable={agents.status === "rejected"} /></section>
    <RunAttentionSection id="attention-approval" title="等待确认或恢复" description="可能有尚未处理的确认，也可能已保存决定但还未恢复。打开详情核对当前草稿、决定记录和可用操作。" emptyTitle="当前范围没有等待确认或恢复的记录" pageKey="approvalPage" state={state} result={approval} />
    <RunAttentionSection id="attention-event" title="等待继续" description="包括等待外部消息或到点继续的任务，并非都需要手动补充。只有详情明确提供提交入口时才能发送消息。" emptyTitle="当前范围没有等待继续的记录" pageKey="eventPage" state={state} result={event} />
    <RunAttentionSection id="attention-failed" title="失败待核对" description="失败状态不代表尚未有人处理。请先查看实际错误、已完成步骤与原输入，再决定是否重新执行。" emptyTitle="当前范围没有失败记录" pageKey="failedPage" state={state} result={failed} />
  </main>;
}
