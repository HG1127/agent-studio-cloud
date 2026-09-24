"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AgentSummary } from "@/contracts/agent";
import { setAgentArchivedAction } from "@/server/actions/set-agent-archived";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function AgentList({ agents, archived = false }: { agents: AgentSummary[]; archived?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (agents.length === 0) {
    return <p className="text-gray-500">{archived ? "没有已停用的助手" : "还没有助手，创建第一个吧"}</p>;
  }
  return (
    <>
      <ul className="flex flex-col gap-3">
        {agents.map((agent) => (
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
