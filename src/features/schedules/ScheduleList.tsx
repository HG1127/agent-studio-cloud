"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, CirclePause, CirclePlay, ExternalLink, History, PauseCircle, RefreshCw, Trash2 } from "lucide-react";
import type { ScheduleView } from "@/contracts/schedule";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { updateScheduleStatusAction } from "@/server/actions/update-schedule-status";

type Filter = "all" | "active" | "paused" | "attention";
const STATUS_LABELS: Record<ScheduleView["status"], string> = { active: "已启用", paused: "已暂停", error: "需要处理", archived: "已归档" };
const STATUS_HINTS: Record<ScheduleView["status"], string> = {
  active: "会在下次执行时间自动创建运行记录",
  paused: "不会自动运行，恢复后会重新计算下一次时间",
  error: "已停止自动运行，处理原因后可尝试恢复",
  archived: "已归档，不再自动运行",
};
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const STATUS_PRIORITY: Record<ScheduleView["status"], number> = { error: 0, active: 1, paused: 2, archived: 3 };

export function orderSchedules(items: ScheduleView[]): ScheduleView[] {
  return [...items].sort((left, right) => {
    const priority = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
    if (priority) return priority;
    if (left.status === "active" && right.status === "active") {
      const nextLeft = left.nextRunAt ?? "9999";
      const nextRight = right.nextRunAt ?? "9999";
      if (nextLeft !== nextRight) return nextLeft < nextRight ? -1 : 1;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function specSummary(spec: ScheduleView["spec"]): string {
  if (spec.kind === "once") return `${new Date(spec.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} 执行一次`;
  if (spec.kind === "interval") return `每 ${spec.minutes} 分钟`;
  const times = spec.times.join("、");
  if (spec.kind === "daily") return `每天 ${times}`;
  if (spec.kind === "weekly") return `每周${spec.weekdays.map((day) => WEEKDAY_LABELS[day]).join("、")} ${times}`;
  return `每月 ${spec.days.join("、")} 日 ${times}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function nextRunLabel(schedule: ScheduleView): string {
  if (schedule.status === "paused") return "已暂停";
  if (schedule.status === "error") return "处理后再计算";
  if (schedule.status === "archived") return "已归档";
  return schedule.nextRunAt ? formatDate(schedule.nextRunAt) : "暂无";
}

export function ScheduleList({ initial }: { initial: ScheduleView[] }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const updatingRef = useRef(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!initial.length) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !updatingRef.current) startTransition(() => router.refresh());
    }, 15000);
    return () => clearInterval(timer);
  }, [initial.length, router]);

  const counts = useMemo(() => ({
    all: initial.length,
    active: initial.filter((item) => item.status === "active").length,
    paused: initial.filter((item) => item.status === "paused").length,
    attention: initial.filter((item) => item.status === "error").length,
  }), [initial]);
  const visible = orderSchedules(filter === "all" ? initial
    : initial.filter((item) => item.status === (filter === "attention" ? "error" : filter)));
  const archiveTarget = initial.find((item) => item.id === archiveId);

  async function update(id: string, next: "paused" | "active" | "archived") {
    if (updatingRef.current) return;
    updatingRef.current = true;
    setError(null); setNotice(null); setUpdatingId(id);
    try {
      const result = await updateScheduleStatusAction(id, next);
      if (!result.ok) {
        setError(result.error);
        startTransition(() => router.refresh());
        return;
      }
      setNotice(next === "paused" ? "已暂停自动运行。" : next === "active" ? "已恢复自动运行，下一次时间已重新计算。" : "定时任务已归档，已有运行记录仍会保留。");
      startTransition(() => router.refresh());
    } catch {
      setError("暂时无法确认任务状态是否已改变。请先重新读取状态，核对后再决定是否重试。");
      startTransition(() => router.refresh());
    } finally {
      setArchiveId(null);
      setUpdatingId(null);
      updatingRef.current = false;
    }
  }

  if (!initial.length) return <div className="space-y-3">
    {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p> : null}
    <EmptyState icon={CalendarClock} title="还没有定时任务" description="创建第一条自动运行计划。这里只会使用助手已经发布的正式版本。" action={<button type="button" onClick={() => startTransition(() => router.refresh())} className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">重新读取状态</button>} />
  </div>;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary icon={CalendarClock} label="全部任务" value={counts.all} tone="slate" />
        <Summary icon={CheckCircle2} label="已启用" value={counts.active} tone="emerald" />
        <Summary icon={PauseCircle} label="已暂停" value={counts.paused} tone="amber" />
        <Summary icon={AlertTriangle} label="需要处理" value={counts.attention} tone="red" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="筛选定时任务" className="grid w-full grid-cols-2 rounded-xl border border-slate-200 bg-white p-1 sm:inline-flex sm:w-fit">
          {([{ id: "all", label: "全部", count: counts.all }, { id: "active", label: "已启用", count: counts.active }, { id: "paused", label: "已暂停", count: counts.paused }, { id: "attention", label: "需要处理", count: counts.attention }] as const).map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${filter === item.id ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}>{item.label}<span className={`ml-1.5 ${filter === item.id ? "text-slate-300" : "text-slate-400"}`}>{item.count}</span></button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3"><p className="text-xs text-slate-500">页面可见时每 15 秒读取状态，不会重复运行任务。</p><button type="button" disabled={refreshing} onClick={() => startTransition(() => router.refresh())} className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900 disabled:text-slate-400"><RefreshCw aria-hidden="true" className={`size-3.5 ${refreshing ? "motion-safe:animate-spin" : ""}`} />{refreshing ? "正在读取…" : "重新读取状态"}</button></div>
      </div>
      <p className="text-xs leading-5 text-slate-500">先显示需要处理的任务；已启用任务按下次运行时间排序。</p>

      {error ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => startTransition(() => router.refresh())} className="font-semibold underline underline-offset-2">刷新列表核对</button></div> : null}
      {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p> : null}
      {!visible.length ? <EmptyState icon={AlertTriangle} title="当前筛选下没有任务" description="任务状态变化后会自动出现在这里，也可以返回查看全部任务。" action={<button type="button" onClick={() => setFilter("all")} className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">查看全部任务</button>} /> : (
        <ul className="space-y-3">
          {visible.map((schedule) => {
            const active = schedule.status === "active";
            const failed = schedule.status === "error";
            return <li key={schedule.id} className={`overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${failed ? "border-red-200" : "border-slate-200"}`}>
              <div className="flex flex-col gap-5 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                  <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${active ? "bg-indigo-50 text-indigo-700" : failed ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-500"}`}><CalendarClock className="size-5" /></span>
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-semibold text-slate-950">{schedule.agentName}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-emerald-50 text-emerald-700" : failed ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{STATUS_LABELS[schedule.status]}</span></div><p className="mt-1 text-sm font-medium text-slate-700">{specSummary(schedule.spec)}</p><p className="mt-1 text-xs leading-5 text-slate-500">{STATUS_HINTS[schedule.status]}</p></div>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 sm:min-w-[300px]">
                  <div><p className="text-[11px] font-medium text-slate-400">下次自动运行</p><p className="mt-1 text-sm font-semibold text-slate-800">{nextRunLabel(schedule)}</p></div>
                  <div><p className="text-[11px] font-medium text-slate-400">创建时间</p><p className="mt-1 text-sm font-semibold text-slate-800">{formatDate(schedule.createdAt)}</p></div>
                </div>
              </div>
              {failed ? <div className="mx-4 mb-4 rounded-xl border border-red-200 bg-red-50 p-4 sm:mx-5 sm:mb-5"><div className="flex gap-3"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-700" /><div><p className="text-sm font-semibold text-red-900">自动运行已停止{schedule.consecutiveFailures ? `，连续失败 ${schedule.consecutiveFailures} 次` : ""}</p><p className="mt-1 text-sm leading-6 text-red-800">{schedule.lastError ?? "系统没有返回具体失败原因，请先查看运行记录。"}</p></div></div></div> : null}
              <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><Link href={`/runs?source=schedule&agent=${schedule.agentId}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900"><History className="size-3.5" />查看此助手的自动运行记录<ExternalLink className="size-3" /></Link><Link href={`/agents/${schedule.agentId}`} className="text-xs font-semibold text-slate-600 hover:text-indigo-700">查看助手版本</Link></div>
                <div className="flex flex-wrap gap-2"><button type="button" disabled={Boolean(updatingId)} onClick={() => void update(schedule.id, active ? "paused" : "active")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50">{active ? <CirclePause className="size-3.5" /> : <CirclePlay className="size-3.5" />}{updatingId === schedule.id ? "正在更新…" : active ? "暂停" : failed ? "尝试恢复" : "恢复运行"}</button><button type="button" disabled={Boolean(updatingId)} onClick={() => setArchiveId(schedule.id)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"><Trash2 className="size-3.5" />归档</button></div>
              </div>
            </li>;
          })}
        </ul>
      )}
      <ConfirmDialog open={Boolean(archiveTarget)} onOpenChange={(next) => { if (!next) setArchiveId(null); }} title="归档这条定时任务？" description={`归档后，“${archiveTarget?.agentName ?? "这条任务"}”不会再自动运行，已有运行记录仍会保留。此操作目前不能在页面中撤销。`} confirmLabel="确认归档" pending={Boolean(updatingId)} onConfirm={() => { if (archiveTarget) void update(archiveTarget.id, "archived"); }} />
    </div>
  );
}

function Summary({ icon: Icon, label, value, tone }: { icon: typeof CalendarClock; label: string; value: number; tone: "slate" | "emerald" | "amber" | "red" }) {
  const colors = { slate: "bg-slate-100 text-slate-600", emerald: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700" };
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><p className="text-xs font-medium text-slate-500">{label}</p><span className={`grid size-8 place-items-center rounded-lg ${colors[tone]}`}><Icon className="size-4" /></span></div><p className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{value}</p></div>;
}
