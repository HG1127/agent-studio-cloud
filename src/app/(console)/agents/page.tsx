import Link from "next/link";
import { CreateAgentForm } from "@/features/agents/CreateAgentForm";
import { AgentList } from "@/features/agents/AgentList";
import { ImportAgentForm } from "@/features/agents/ImportAgentForm";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { firstSearchParam, pageFromSearchParam } from "@/lib/search-params";
import { listAgents, listArchivedAgents } from "@/server/queries/agents";
import { withSafeQueryError } from "@/server/security/query-error";

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
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-10 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">助手列表</h1>
        <p className="text-sm text-gray-500">把一句业务需求变成一个能跑流程的助手。</p>
      </header>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-gray-600">查找助手
          <input type="search" name="q" defaultValue={query} maxLength={200} placeholder="输入名称或说明" className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white">查找</button>
        {query ? <Link href="/agents" className="px-1 py-2 text-sm text-gray-500 hover:text-gray-800">清除查找</Link> : null}
      </form>
      <div>
        <AgentList agents={agents} serverManaged />
        <Pagination label="在用助手分页" page={page} hasNext={hasNext}
          previousHref={pageHref(query, page - 1, archivedPage)} nextHref={pageHref(query, page + 1, archivedPage)} />
      </div>
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">创建新助手</h2>
        <CreateAgentForm />
      </section>
      <ImportAgentForm />
      {archivedAgents.length > 0 || archivedPage > 1 ? (
        <section className="flex flex-col gap-4 border-t border-gray-200 pt-6">
          <div>
            <h2 className="text-lg font-semibold">已停用的助手</h2>
            <p className="mt-1 text-sm text-gray-500">恢复后可继续编辑和运行；关联的定时任务仍保持暂停。</p>
          </div>
          <AgentList agents={archivedAgents} archived serverManaged />
          <Pagination label="已停用助手分页" page={archivedPage} hasNext={archivedHasNext}
            previousHref={pageHref(query, page, archivedPage - 1)} nextHref={pageHref(query, page, archivedPage + 1)} />
        </section>
      ) : null}
    </main>
  );
}
