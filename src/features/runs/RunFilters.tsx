import Link from "next/link";
import { Filter, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { RunAgentOption, RunListFilters } from "@/contracts/run";

const SOURCES = [
  ["manual", "手动运行"],
  ["schedule", "定时任务"],
  ["agent_call", "助手协作"],
  ["handoff", "助手交接"],
  ["evaluation", "自动验收"],
] as const;

const STATUSES = [
  ["queued", "排队中"],
  ["running", "运行中"],
  ["waiting_approval", "等待确认"],
  ["waiting_event", "等待继续"],
  ["completed", "已完成"],
  ["failed", "失败"],
  ["cancelled", "已取消"],
] as const;

export function RunFilters({ filters, agents, action = "/runs", showStatus = true, agentsUnavailable = false }: { filters: RunListFilters; agents: RunAgentOption[]; action?: string; showStatus?: boolean; agentsUnavailable?: boolean }) {
  const active = Boolean(filters.status || filters.sourceType || filters.agentId);
  const filterKey = `${filters.status ?? "all"}:${filters.sourceType ?? "all"}:${filters.agentId ?? "all"}`;
  const activeLabels = [
    filters.status ? STATUSES.find(([value]) => value === filters.status)?.[1] : null,
    filters.sourceType ? SOURCES.find(([value]) => value === filters.sourceType)?.[1] : null,
    filters.agentId ? agents.find((agent) => agent.id === filters.agentId)?.name ?? "当前所选助手（名称暂不可用）" : null,
  ].filter((label): label is string => Boolean(label));
  return (
    <form key={filterKey} action={action} method="get" aria-label={showStatus ? "筛选运行记录" : "筛选待处理任务"} className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><SlidersHorizontal aria-hidden="true" className="size-4" /></span>
        <div>
          <h2 className="text-sm font-semibold text-slate-950">缩小查看范围</h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">{showStatus ? "按状态、发起方式或助手组合筛选，条件会保留在当前链接中。" : "按发起方式和助手筛选三个分类。应用新范围后，各分类回到第一页。"}</p>
        </div>
      </div>
      <div className={`grid gap-3 sm:grid-cols-2 xl:items-end ${showStatus ? "xl:grid-cols-[minmax(9rem,0.7fr)_minmax(9rem,0.7fr)_minmax(14rem,1.6fr)_auto]" : "xl:grid-cols-[minmax(9rem,1fr)_minmax(14rem,2fr)_auto]"}`}>
        {showStatus ? <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-slate-600">
          运行状态
          <select name="status" aria-label="运行状态" defaultValue={filters.status ?? ""} className="h-10 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">
            <option value="">全部状态</option>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label> : null}
        <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-slate-600">
          发起方式
          <select name="source" aria-label="发起方式" defaultValue={filters.sourceType ?? ""} className="h-10 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">
            <option value="">全部方式</option>
            {SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-slate-600">
          助手
          <select name="agent" aria-label="助手" disabled={agentsUnavailable} defaultValue={filters.agentId ?? ""} className="h-10 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100">
            <option value="">全部助手</option>
            {filters.agentId && !agents.some((agent) => agent.id === filters.agentId) ? <option value={filters.agentId}>当前所选助手（名称暂不可用）</option> : null}
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        {agentsUnavailable && filters.agentId ? <input type="hidden" name="agent" value={filters.agentId} /> : null}
        <button type="submit" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700">
          <Filter aria-hidden="true" className="size-4" />应用筛选
        </button>
      </div>
      {active ? (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-xs text-indigo-900"><span className="font-semibold">当前范围：</span>{activeLabels.join(" · ")}</p>
          <Link href={action} className="inline-flex shrink-0 items-center gap-1.5 self-start text-xs font-semibold text-indigo-700 hover:text-indigo-900">
            <RotateCcw aria-hidden="true" className="size-3.5" />清除筛选
          </Link>
        </div>
      ) : null}
    </form>
  );
}
