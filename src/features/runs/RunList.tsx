import Link from "next/link";
import { RunStatus, type RunListFilters, type RunSummary } from "@/contracts/run";
import { Activity, ArrowRight, Bot, ChevronRight, SearchX } from "lucide-react";
import { runDetailHref, runsHref } from "./run-filter-url";

// 状态徽标唯一文案源：列表页与详情页共用
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "排队中",
  running: "运行中",
  waiting_approval: "等待确认",
  waiting_event: "等待继续",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const RUN_STATUS_STYLES: Record<RunStatus, string> = {
  queued: "bg-gray-100 text-gray-600",
  running: "bg-blue-50 text-blue-700",
  waiting_approval: "bg-amber-50 text-amber-700",
  waiting_event: "bg-cyan-50 text-cyan-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const RUN_SOURCE_LABEL: Record<RunSummary["sourceType"], string> = {
  manual: "手动运行",
  schedule: "定时任务",
  agent_call: "助手协作",
  handoff: "助手交接",
  evaluation: "自动验收",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${RUN_STATUS_STYLES[status]}`}>
      {RUN_STATUS_LABEL[status]}
    </span>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const duration = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  const seconds = Math.round(duration / 1_000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

export function RunList({ runs, filtered = false, filters = {}, page = 1, returnHref }: { runs: RunSummary[]; filtered?: boolean; filters?: RunListFilters; page?: number; returnHref?: string }) {
  if (runs.length === 0) {
    const emptyPage = page > 1;
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center">
        <span className="grid size-11 place-items-center rounded-xl bg-white text-indigo-600 shadow-sm">{filtered || emptyPage ? <SearchX aria-hidden="true" className="size-5" /> : <Activity aria-hidden="true" className="size-5" />}</span>
        <h3 className="mt-4 font-semibold text-slate-900">{emptyPage ? "当前页没有运行记录" : filtered ? "没有符合当前条件的记录" : "还没有运行记录"}</h3>
        <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{emptyPage ? "记录可能已有变化。可以保留筛选条件回到第一页，再选择需要查看的任务。" : filtered ? "可以调整筛选条件，或回到全部记录继续查找。" : "先选择一位已发布的助手，提交一项真实工作后，这里会保留进度和结果。"}</p>
        <Link href={emptyPage ? runsHref(filters) : filtered ? "/runs" : "/agents"} className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">
          {emptyPage ? "回到第一页" : filtered ? "查看全部记录" : "选择助手"}<ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    );
  }
  return (
    <div>
      <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.5fr)_minmax(7rem,0.55fr)_minmax(8rem,0.65fr)_minmax(11rem,0.85fr)_1.5rem] gap-4 border-b border-slate-200 px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 md:grid">
        <span>任务</span><span>状态</span><span>发起方式</span><span>时间与版本</span><span />
      </div>
      <ul className="divide-y divide-slate-100">
      {runs.map((run) => (
        <li key={run.id}>
          <Link
            href={returnHref ? `/runs/${run.id}?${new URLSearchParams({ from: returnHref })}` : runDetailHref(run.id, filters, page)}
            className="group my-1 grid min-w-0 gap-3 rounded-xl px-3 py-3 transition hover:bg-indigo-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:grid-cols-[minmax(0,1.5fr)_minmax(7rem,0.55fr)_minmax(8rem,0.65fr)_minmax(11rem,0.85fr)_1.5rem] md:items-center md:gap-4"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><Bot aria-hidden="true" className="size-4" /></span>
              <span className="min-w-0 pt-0.5">
                <span className="block truncate text-sm font-semibold text-slate-950">{run.agentName}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400 md:hidden">
                  <span>{RUN_SOURCE_LABEL[run.sourceType]}</span><span aria-hidden="true">·</span><span>{run.version === null ? "版本不可用" : `版本 ${run.version}`}</span>
                </span>
                {run.agentArchived ? <span className="mt-1 inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">助手已停用</span> : null}
              </span>
            </div>
            <span className="flex items-center justify-between gap-2 md:block"><span className="text-xs font-medium text-slate-400 md:hidden">当前状态</span><RunStatusBadge status={run.status} /></span>
            <span className="hidden text-sm text-slate-600 md:block">{RUN_SOURCE_LABEL[run.sourceType]}</span>
            <span className="flex items-start justify-between gap-3 text-xs text-slate-500 md:block">
              <span className="font-medium text-slate-400 md:hidden">时间</span>
              <span className="text-right md:text-left">
                <span className="block">{run.startedAt ? formatTime(run.startedAt) : "尚未开始"}</span>
                <span className="mt-1 block text-[11px] text-slate-400">{formatDuration(run.startedAt, run.finishedAt) ? `耗时 ${formatDuration(run.startedAt, run.finishedAt)} · ` : ""}{run.version === null ? "版本不可用" : `版本 ${run.version}`}</span>
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="hidden size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500 md:block" />
          </Link>
        </li>
      ))}
      </ul>
    </div>
  );
}

export function RunPagination({ page, hasNext, filters }: {
  page: number;
  hasNext: boolean;
  filters: RunListFilters;
}) {
  if (page === 1 && !hasNext) return null;
  return (
    <nav aria-label="运行记录翻页" className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
      {page > 1
        ? <Link href={runsHref(filters, page - 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">上一页</Link>
        : <span />}
      <span className="text-xs font-medium text-slate-500">第 {page} 页</span>
      {hasNext
        ? <Link href={runsHref(filters, page + 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">下一页</Link>
        : <span />}
    </nav>
  );
}
