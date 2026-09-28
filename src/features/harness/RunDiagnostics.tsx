import Link from "next/link";
import { ArrowRight, CircleAlert, ListChecks, ShieldCheck } from "lucide-react";
import { MAX_VISIBLE_TRACE_EVENTS, type RunStepView, type RunView, type TraceEventView } from "@/contracts/run";
import { RunStatusBadge } from "@/features/runs/RunList";
import { DiagnosticTrace } from "./DiagnosticTrace";

const STEP_LABELS: Record<RunStepView["status"], string> = {
  pending: "待执行", running: "运行中", succeeded: "已完成", failed: "失败",
};

function formatDate(value: string | null): string {
  if (!value) return "尚无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function RunDiagnostics({ run, steps, trace }: { run: RunView; steps: RunStepView[]; trace: TraceEventView[] }) {
  const failedSteps = steps.filter((step) => step.status === "failed").length;
  const completedSteps = steps.filter((step) => step.status === "succeeded").length;
  const attentionEvents = trace.filter((event) => event.level !== "info").length;

  return <div className="min-w-0 space-y-4">
    <section className="content-card min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">本次运行</p><h2 className="mt-1 break-words text-xl font-bold text-slate-950">{run.agentName}</h2><div className="mt-2 flex flex-wrap items-center gap-2"><RunStatusBadge status={run.status} /><span className="text-xs text-slate-500">{run.version === null ? "运行版本不可用" : `版本 ${run.version}`}</span></div></div><Link href={`/runs/${run.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-700 hover:text-indigo-900">打开任务详情<ArrowRight className="size-4" /></Link></div>
      <p className="mt-4 text-xs leading-5 text-slate-500">开始：{formatDate(run.startedAt)}{run.finishedAt ? ` · 结束：${formatDate(run.finishedAt)}` : ""} · 北京时间</p>
      {run.error ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800"><p className="font-semibold">本次运行未完成的原因</p><p className="mt-1 whitespace-pre-wrap break-words">{run.error}</p></div> : null}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-slate-50 p-3"><ListChecks className="size-4 text-indigo-600" /><p className="mt-2 text-lg font-bold text-slate-950">{completedSteps}/{steps.length}</p><p className="text-xs text-slate-500">已完成步骤</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><CircleAlert className="size-4 text-red-600" /><p className="mt-2 text-lg font-bold text-slate-950">{failedSteps}</p><p className="text-xs text-slate-500">失败步骤</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><ShieldCheck className="size-4 text-amber-600" /><p className="mt-2 text-lg font-bold text-slate-950">{attentionEvents}</p><p className="text-xs text-slate-500">最近需关注事件</p></div>
      </div>
    </section>
    <section aria-labelledby="diagnostic-steps-title" className="content-card min-w-0"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 id="diagnostic-steps-title" className="section-title">已保存的步骤</h2><p className="mt-1 text-sm text-slate-500">按真实步骤记录展示，不从流程草稿推测计划。</p></div><Link href={`/runs/${run.id}#steps`} className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">查看步骤数据</Link></div>
      {steps.length ? <ol className="mt-3 divide-y divide-slate-100">{steps.map((step) => <li key={step.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><span className="min-w-0 break-words text-sm font-medium text-slate-800">{step.nodeTitle ?? "未命名步骤"}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${step.status === "failed" ? "bg-red-50 text-red-700" : step.status === "succeeded" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{STEP_LABELS[step.status]}</span></li>)}</ol> : <p className="mt-3 text-sm text-slate-500">尚无步骤记录；可在任务详情查看当前状态。</p>}
    </section>
    <DiagnosticTrace events={trace} />
    {trace.length >= MAX_VISIBLE_TRACE_EVENTS ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">这里只展示最近 {MAX_VISIBLE_TRACE_EVENTS} 条轨迹。完整轨迹可从任务详情下载运行报告。</p> : null}
  </div>;
}
