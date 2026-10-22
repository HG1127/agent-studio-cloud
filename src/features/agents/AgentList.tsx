"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AgentSummary } from "@/contracts/agent";
import { RunListFilters } from "@/contracts/run";
import { AttentionListState, attentionHref } from "@/features/runs/run-attention-url";
import { runsHref } from "@/features/runs/run-filter-url";
import { setAgentArchivedAction } from "@/server/actions/set-agent-archived";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Bot, ChevronRight } from "lucide-react";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const PAGE_SIZE = 20;

export function AgentList({ agents, archived = false, serverManaged = false, searchQuery = "", emptyPageHref }: { agents: AgentSummary[]; archived?: boolean; serverManaged?: boolean; searchQuery?: string; emptyPageHref?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AgentSummary | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return agents;
    return agents.filter((agent) =>
      `${agent.name} ${agent.description ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalized),
    );
  }, [agents, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = serverManaged ? agents : filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  function changeArchived(agent: AgentSummary, shouldArchive: boolean) {
    if (pending) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await setAgentArchivedAction({ agentId: agent.id, archived: shouldArchive });
        setConfirmTarget(null);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setNotice(shouldArchive
          ? `已停用「${agent.name}」；关联的定时任务已暂停。`
          : `已恢复「${agent.name}」；关联的定时任务仍需单独恢复。`);
        router.refresh();
      } catch {
        setConfirmTarget(null);
        setError(`暂时无法确认「${agent.name}」是否已${shouldArchive ? "停用" : "恢复"}。请先刷新列表核对状态，再决定是否重试。`);
      }
    });
  }
  if (agents.length === 0) {
    const kind = archived ? "已停用助手" : "在用助手";
    const emptyMessage = emptyPageHref
      ? `当前页没有${searchQuery.trim() ? "匹配的" : ""}${kind}`
      : searchQuery.trim() ? `没有找到匹配的${kind}`
        : archived ? "没有已停用的助手" : "还没有助手，创建第一个吧";
    return <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-9 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-white text-indigo-600 shadow-sm"><Bot className="size-5" /></span>
      <p className="mt-3 text-sm font-medium text-slate-700">{emptyMessage}</p>
      {emptyPageHref ? <Link href={emptyPageHref} className="mt-2 text-sm font-semibold text-indigo-700 hover:underline">返回上一页</Link>
        : searchQuery.trim() && serverManaged ? <Link href="/agents" className="mt-2 text-sm font-semibold text-indigo-700 hover:underline">查看全部助手</Link> : null}
    </div>;
  }
  return (
    <>
      {!serverManaged ? <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex min-w-64 flex-1 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
          <span className="shrink-0 text-gray-500">查找助手</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="输入名称或说明"
            className="min-w-0 flex-1 outline-none"
          />
        </label>
        <span className="text-sm text-gray-500">共 {filtered.length} 个</span>
      </div> : null}
      {visible.length === 0 ? <p className="py-4 text-sm text-gray-500">没有找到匹配的助手</p> : null}
      <ul className="flex flex-col gap-3">
        {visible.map((agent) => (
          <li key={agent.id} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200 hover:bg-indigo-50/20">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Bot className="size-[18px]" /></span>
            {archived ? <div className="min-w-0 flex-1">
              <AgentSummaryContent agent={agent} linked={false} />
            </div> : <div className="min-w-0 flex-1">
              <Link href={`/agents/${agent.id}`} className="block"><AgentSummaryContent agent={agent} linked /></Link>
              {agent.archivedAt === null ? <AgentRunNavigation agent={agent} /> : null}
            </div>}
            <button
              type="button"
              disabled={pending}
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
              onClick={() => {
                if (archived) changeArchived(agent, false);
                else setConfirmTarget(agent);
              }}
            >
              {archived ? "恢复" : "停用"}
            </button>
          </li>
        ))}
      </ul>
      {!serverManaged && pageCount > 1 ? <nav aria-label="助手列表分页" className="mt-4 flex items-center justify-end gap-3 text-sm">
        <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">上一页</button>
        <span>第 {currentPage} / {pageCount} 页</span>
        <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">下一页</button>
      </nav> : null}
      {error ? <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => router.refresh()} className="font-semibold underline underline-offset-2">刷新列表核对</button></div> : null}
      {notice ? <p role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}
      <ConfirmDialog open={Boolean(confirmTarget)} onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}
        title={confirmTarget ? `停用「${confirmTarget.name}」？` : "停用助手？"}
        description="停用后不能再启动这个助手，关联的定时任务会暂停。恢复助手不会自动恢复这些定时任务，需要逐项重新启用。正在被其他助手使用时，系统会阻止停用。"
        confirmLabel="确认停用" pending={pending} onConfirm={() => { if (confirmTarget) changeArchived(confirmTarget, true); }} />
    </>
  );
}

function AgentRunNavigation({ agent }: { agent: AgentSummary }) {
  const parsed = AgentSummary.shape.id.safeParse(agent.id);
  if (!parsed.success) return null;
  const filters = RunListFilters.parse({ agentId: parsed.data.toLowerCase() });
  const attention = AttentionListState.parse(filters);
  return <nav aria-label={`${agent.name}的运行入口`} className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-indigo-700">
    <Link href={attentionHref(attention)} prefetch={false} className="hover:text-indigo-900 hover:underline">查看待处理任务</Link>
    <Link href={runsHref(filters)} prefetch={false} className="hover:text-indigo-900 hover:underline">查看运行记录</Link>
  </nav>;
}

function AgentSummaryContent({ agent, linked }: { agent: AgentSummary; linked: boolean }) {
  return <>
    <div className="flex items-center justify-between gap-4">
      <span className="min-w-0 break-words font-semibold text-slate-900">{agent.name}</span>
      <span className="flex items-center gap-1 text-xs text-slate-400">
        {agent.versionCount === 1 ? "1 个版本" : `${agent.versionCount} 个版本`}
        {linked ? <ChevronRight aria-hidden="true" className="size-3.5" /> : null}
      </span>
    </div>
    {agent.description ? <p className="mt-1 text-sm text-gray-500">{agent.description}</p> : null}
    <p className="mt-2 text-sm text-gray-400">
      更新于 {dateFormatter.format(new Date(agent.updatedAt))}
    </p>
  </>;
}
