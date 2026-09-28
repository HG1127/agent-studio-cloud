import { RunListFilters } from "@/contracts/run";
import { RunFilters } from "@/features/runs/RunFilters";
import { RunFocusNav } from "@/features/runs/RunFocusNav";
import { RunList, RunPagination } from "@/features/runs/RunList";
import { RunRefreshButton } from "@/features/runs/RunRefreshButton";
import { runsHref } from "@/features/runs/run-filter-url";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { firstSearchParam, pageFromSearchParam } from "@/lib/search-params";
import { listRunAgentOptions, listRuns } from "@/server/queries/runs";
import { withSafeQueryError } from "@/server/security/query-error";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { CalendarClock, ListFilter } from "lucide-react";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function RunsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsed = RunListFilters.safeParse({
    status: firstSearchParam(params.status) || undefined,
    sourceType: firstSearchParam(params.source) || undefined,
    agentId: firstSearchParam(params.agent) || undefined,
  });
  const filters = parsed.success ? parsed.data : {};
  const page = pageFromSearchParam(params.page);
  const [runs, agentOptions] = await withSafeQueryError(() => Promise.all([
    listRuns(DEMO_WORKSPACE_ID, filters, { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    listRunAgentOptions(DEMO_WORKSPACE_ID),
  ]), "runs-page");
  const hasNext = runs.length > PAGE_SIZE;
  const visibleRuns = runs.slice(0, PAGE_SIZE);
  const hasActiveFilters = Boolean(filters.status || filters.sourceType || filters.agentId);
  return (
    <main className="page-shell">
      <PageHeader eyebrow="任务与执行" title="运行中心" description="先处理需要决定和失败的任务，再查看正在执行的进度与最终结果。技术过程保留在详情中。"
        action={<div className="flex flex-wrap gap-2"><RunRefreshButton /><Link href="/schedules" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"><CalendarClock className="size-4" />定时任务</Link></div>} />
      <section aria-labelledby="run-focus-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="run-focus-title" className="section-title">先看需要你关注的任务</h2><p className="mt-1 text-sm text-slate-500">切换状态时保留已选助手和发起方式；筛选不会改变正在执行的任务。</p></div>
          {filters.status ? <Link href={runsHref({ ...filters, status: undefined })} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">查看当前范围的全部状态 →</Link> : null}
        </div>
        <RunFocusNav filters={filters} />
      </section>
      <section className="content-card"><RunFilters filters={filters} agents={agentOptions} /></section>
      <section className="content-card">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="section-title">{hasActiveFilters ? "筛选结果" : "最近运行"}</h2><p className="mt-1 text-sm text-slate-500">选择一项记录查看步骤、确认事项和最终结果。</p></div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600"><ListFilter aria-hidden="true" className="size-3.5" />本页 {visibleRuns.length} 条{hasNext ? "，还有更多" : ""}</span>
        </div>
        <RunList runs={visibleRuns} filtered={hasActiveFilters} filters={filters} page={page} />
        <div className="mt-4"><RunPagination page={page} hasNext={hasNext} filters={filters} /></div>
      </section>
    </main>
  );
}
