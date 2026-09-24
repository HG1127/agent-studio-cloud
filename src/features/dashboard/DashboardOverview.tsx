import Link from "next/link";
import type { DashboardSummary } from "@/contracts/dashboard";
import type { RunSummary } from "@/contracts/run";
import { RunList } from "@/features/runs/RunList";

export function DashboardOverview({ summary, recentRuns }: {
  summary: DashboardSummary;
  recentRuns: RunSummary[];
}) {
  const cards = [
    { label: "在用助手", value: summary.activeAgents, detail: `${summary.publishedAgents} 个已发布`, href: "/agents" },
    { label: "已就绪资料", value: summary.indexedSources, detail: "可供助手检索", href: "/knowledge" },
    { label: "近 24 小时运行", value: summary.runsLast24h, detail: `${summary.failuresLast24h} 次失败`, href: "/runs" },
    { label: "正在处理", value: summary.activeRuns, detail: `${summary.pendingApprovals} 项等待确认`, href: "/runs?status=waiting_approval" },
  ];
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.label} href={card.href} className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-400">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900">{card.value}</p>
            <p className="mt-1 text-xs text-gray-500">{card.detail}</p>
          </Link>
        ))}
      </section>
      {summary.pendingApprovals > 0 ? (
        <Link href="/runs?status=waiting_approval" className="block rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          有 {summary.pendingApprovals} 项工作等待员工确认，点击查看并处理。
        </Link>
      ) : null}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">最近运行</h2>
          <Link href="/runs" className="text-sm text-blue-700 hover:underline">查看全部</Link>
        </div>
        <RunList runs={recentRuns} />
      </section>
    </>
  );
}
