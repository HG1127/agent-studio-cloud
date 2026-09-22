import Link from "next/link";
import type { AgentSummary } from "@/contracts/agent";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function AgentList({ agents }: { agents: AgentSummary[] }) {
  if (agents.length === 0) {
    return <p className="text-gray-500">还没有助手，创建第一个吧</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {agents.map((agent) => (
        <li key={agent.id}>
          <Link
            href={`/agents/${agent.id}`}
            className="block rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-400"
          >
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
          </Link>
        </li>
      ))}
    </ul>
  );
}
