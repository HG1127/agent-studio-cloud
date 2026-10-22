import Link from "next/link";
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

export function RunFilters({ filters, agents }: { filters: RunListFilters; agents: RunAgentOption[] }) {
  const active = Boolean(filters.status || filters.sourceType || filters.agentId);
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        运行状态
        <select name="status" defaultValue={filters.status ?? ""} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800">
          <option value="">全部状态</option>
          {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        发起方式
        <select name="source" defaultValue={filters.sourceType ?? ""} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800">
          <option value="">全部方式</option>
          {SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="flex min-w-44 flex-col gap-1 text-xs text-gray-600">
        助手
        <select name="agent" defaultValue={filters.agentId ?? ""} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800">
          <option value="">全部助手</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
      </label>
      <button type="submit" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white">筛选</button>
      {active ? <Link href="/runs" className="px-1 py-1.5 text-sm text-gray-500 hover:text-gray-800">清除筛选</Link> : null}
    </form>
  );
}
