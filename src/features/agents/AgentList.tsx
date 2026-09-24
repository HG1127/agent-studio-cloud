"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { AgentSummary } from "@/contracts/agent";
import { setAgentArchivedAction } from "@/server/actions/set-agent-archived";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const PAGE_SIZE = 20;

export function AgentList({ agents, archived = false }: { agents: AgentSummary[]; archived?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  if (agents.length === 0) {
    return <p className="text-gray-500">{archived ? "没有已停用的助手" : "还没有助手，创建第一个吧"}</p>;
  }
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
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
      </div>
      {visible.length === 0 ? <p className="py-4 text-sm text-gray-500">没有找到匹配的助手</p> : null}
      <ul className="flex flex-col gap-3">
        {visible.map((agent) => (
          <li key={agent.id} className="flex items-center gap-3 rounded-lg border border-gray-200 p-4">
            {archived ? <div className="min-w-0 flex-1">
              <AgentSummaryContent agent={agent} />
            </div> : <Link href={`/agents/${agent.id}`} className="min-w-0 flex-1">
              <AgentSummaryContent agent={agent} />
            </Link>}
            <button
              type="button"
              disabled={pending}
              className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:border-gray-500 disabled:opacity-50"
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const result = await setAgentArchivedAction({ agentId: agent.id, archived: !archived });
                    if (!result.ok) setError(result.error);
                    else router.refresh();
                  } catch {
                    setError(archived ? "恢复失败，请检查网络后重试" : "停用失败，请检查网络后重试");
                  }
                });
              }}
            >
              {archived ? "恢复" : "停用"}
            </button>
          </li>
        ))}
      </ul>
      {pageCount > 1 ? <nav aria-label="助手列表分页" className="mt-4 flex items-center justify-end gap-3 text-sm">
        <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">上一页</button>
        <span>第 {currentPage} / {pageCount} 页</span>
        <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">下一页</button>
      </nav> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-red-600">{error}</p> : null}
    </>
  );
}

function AgentSummaryContent({ agent }: { agent: AgentSummary }) {
  return <>
    <div className="flex items-center justify-between gap-4">
      <span className="font-medium">{agent.name}</span>
      <span className="text-sm text-gray-400">
        {agent.versionCount === 1 ? "1 个版本" : `${agent.versionCount} 个版本`}
      </span>
    </div>
    {agent.description ? <p className="mt-1 text-sm text-gray-500">{agent.description}</p> : null}
    <p className="mt-2 text-sm text-gray-400">
      更新于 {dateFormatter.format(new Date(agent.updatedAt))}
    </p>
  </>;
}
