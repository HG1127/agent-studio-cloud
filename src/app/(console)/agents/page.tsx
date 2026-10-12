import Link from "next/link";
import { AgentList } from "@/features/agents/AgentList";
import { AgentRefreshButton } from "@/features/agents/AgentRefreshButton";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { firstSearchParam, pageFromSearchParam } from "@/lib/search-params";
import { listAgents, listArchivedAgents } from "@/server/queries/agents";
import { withSafeQueryError } from "@/server/security/query-error";
import { PageHeader } from "@/components/ui/page-header";
import { Plus, Search } from "lucide-react";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const PAGE_SIZE = 20;

function pageHref(query: string, page: number, archivedPage: number) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  if (archivedPage > 1) params.set("archivedPage", String(archivedPage));
  const suffix = params.toString();
  return suffix ? `/agents?${suffix}` : "/agents";
}

function Pagination({ label, page, hasNext, previousHref, nextHref }: {
  label: string; page: number; hasNext: boolean; previousHref: string; nextHref: string;
}) {
  if (page === 1 && !hasNext) return null;
  return <nav aria-label={label} className="mt-4 flex items-center justify-end gap-3 text-sm">
    {page > 1 ? <Link href={previousHref} className="rounded border px-3 py-1.5">上一页</Link> : <span className="rounded border px-3 py-1.5 opacity-40">上一页</span>}
    <span>第 {page} 页</span>
    {hasNext ? <Link href={nextHref} className="rounded border px-3 py-1.5">下一页</Link> : <span className="rounded border px-3 py-1.5 opacity-40">下一页</span>}
  </nav>;
}

export default async function AgentsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = firstSearchParam(params.q)?.trim().slice(0, 200) ?? "";
  const page = pageFromSearchParam(params.page);
  const archivedPage = pageFromSearchParam(params.archivedPage);
  const [agentRows, archivedRows] = await withSafeQueryError(() => Promise.all([
    listAgents(DEMO_WORKSPACE_ID, { query, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    listArchivedAgents(DEMO_WORKSPACE_ID, { query, limit: PAGE_SIZE + 1, offset: (archivedPage - 1) * PAGE_SIZE }),
  ]), "agents-page");
  const agents = agentRows.slice(0, PAGE_SIZE);
  const archivedAgents = archivedRows.slice(0, PAGE_SIZE);
  const hasNext = agentRows.length > PAGE_SIZE;
  const archivedHasNext = archivedRows.length > PAGE_SIZE;
  return (
    <main className="page-shell">
      <PageHeader eyebrow="AI 工作团队" title="我的助手" description="找到要做的工作，交给助手处理；也可以从一句目标开始创建新助手。"
        action={<><AgentRefreshButton /><Link href="/agents/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"><Plus className="size-4" />新建助手</Link></>} />
      <form method="get" className="content-card flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-gray-600">查找助手
          <span className="relative mt-1 block"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input type="search" name="q" defaultValue={query} maxLength={200} placeholder="搜索工作或助手名称" className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm" /></span>
        </label>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">查找</button>
        {query ? <Link href="/agents" className="px-1 py-2 text-sm text-gray-500 hover:text-gray-800">清除查找</Link> : null}
      </form>
      <section aria-labelledby="active-agents-title" className="content-card">
        <div className="mb-4 flex items-center justify-between gap-3"><div><h2 id="active-agents-title" className="section-title">在用助手</h2><p className="mt-1 text-sm text-slate-500">打开助手可以调整流程、发布版本或开始运行。</p></div><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">本页 {agents.length} 个</span></div>
        <AgentList agents={agents} serverManaged searchQuery={query}
          emptyPageHref={page > 1 ? pageHref(query, page - 1, archivedPage) : undefined} />
        <Pagination label="在用助手分页" page={page} hasNext={hasNext}
          previousHref={pageHref(query, page - 1, archivedPage)} nextHref={pageHref(query, page + 1, archivedPage)} />
      </section>
      {archivedAgents.length > 0 || archivedPage > 1 ? (
        <section aria-labelledby="archived-agents-title" className="content-card flex flex-col gap-4">
          <div>
            <h2 id="archived-agents-title" className="text-lg font-semibold">已停用的助手</h2>
            <p className="mt-1 text-sm text-gray-500">恢复后可继续编辑和运行；关联的定时任务仍保持暂停。</p>
          </div>
          <AgentList agents={archivedAgents} archived serverManaged searchQuery={query}
            emptyPageHref={archivedPage > 1 ? pageHref(query, page, archivedPage - 1) : undefined} />
          <Pagination label="已停用助手分页" page={archivedPage} hasNext={archivedHasNext}
            previousHref={pageHref(query, page, archivedPage - 1)} nextHref={pageHref(query, page, archivedPage + 1)} />
        </section>
      ) : null}
    </main>
  );
}
