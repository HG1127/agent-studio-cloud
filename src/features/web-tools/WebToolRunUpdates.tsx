"use client";

import { useState } from "react";
import { RunStatus, RunView, type TraceEventView } from "@/contracts/run";
import { useRunStream } from "@/features/runs/use-run-stream";

const EMPTY_EVENTS: TraceEventView[] = [];
export function WebToolRunUpdates({ run }: { run: Pick<RunView, "id" | "status"> }) {
  const [paused, setPaused] = useState(false);
  const valid = RunView.shape.id.safeParse(run.id).success && RunStatus.safeParse(run.status).success;
  const ongoing = valid && !["completed", "failed", "cancelled"].includes(run.status);
  useRunStream(run.id, EMPTY_EVENTS, ongoing && !paused);
  if (!valid) return <p role="status" className="text-xs leading-5 text-amber-900">本次任务的状态暂时无法安全核对，未开启自动更新。请明确重新读取。</p>;
  if (!ongoing) return null;
  return <section aria-label="本次任务自动更新" className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <div className="max-w-2xl space-y-1">
      <p role="status" className="text-xs font-semibold text-slate-800">{paused ? "已暂停本页自动更新，任务仍按原状态执行。" : "本页正在尝试自动读取本次任务的已保存状态。"}</p>
      <p className="text-xs leading-5 text-slate-600">{paused ? "可恢复更新或使用上方“重新读取状态”；暂停更新不会取消任务。" : "连接中断时会间隔重读；事件仅触发重新查询，不据此宣布成功。不会确认待办、重新提交输入或重启任务。"}</p>
    </div>
    <button type="button" onClick={() => setPaused((current) => !current)} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">{paused ? "恢复本页自动更新" : "暂停本页自动更新"}</button>
  </section>;
}
