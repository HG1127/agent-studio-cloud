"use client";

import { useState } from "react";
import type { TraceEventView } from "@/contracts/run";

function eventTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function DiagnosticTrace({ events }: { events: TraceEventView[] }) {
  const [attentionOnly, setAttentionOnly] = useState(false);
  const attentionCount = events.filter((event) => event.level !== "info").length;
  const visible = attentionOnly ? events.filter((event) => event.level !== "info") : events;

  return <section aria-labelledby="diagnostic-trace-title" className="content-card min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="diagnostic-trace-title" className="section-title">执行轨迹</h2><p className="mt-1 text-sm leading-6 text-slate-500">只展示已保存的事件；“需关注”按事件级别筛选，不代表安全规则判决。</p></div>
      <div role="group" aria-label="筛选执行轨迹" className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button type="button" aria-pressed={!attentionOnly} onClick={() => setAttentionOnly(false)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${!attentionOnly ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>全部 {events.length}</button>
        <button type="button" aria-pressed={attentionOnly} onClick={() => setAttentionOnly(true)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${attentionOnly ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>需关注 {attentionCount}</button>
      </div>
    </div>
    {visible.length ? <ol aria-label="已保存的执行事件" className="mt-4 divide-y divide-slate-100">
      {visible.map((event) => <li key={event.id} className="flex min-w-0 gap-3 py-3">
        <span aria-hidden="true" className={`mt-1 size-2.5 shrink-0 rounded-full ${event.level === "error" ? "bg-red-500" : event.level === "warn" ? "bg-amber-500" : "bg-indigo-400"}`} />
        <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-slate-900">{event.title}</p>{event.detail ? <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{event.detail}</p> : null}<p className="mt-1 text-xs text-slate-400">{eventTime(event.at)} · 北京时间</p></div>
      </li>)}
    </ol> : <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{attentionOnly ? "最近轨迹中没有警告或错误事件。" : "这次运行尚无已保存的轨迹事件。"}</p>}
  </section>;
}
