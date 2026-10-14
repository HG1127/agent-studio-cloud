import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CircleAlert, Download, ListChecks, ShieldCheck } from "lucide-react";
import { MAX_VISIBLE_TRACE_EVENTS, type RunStepView, type RunView, type TraceEventView } from "@/contracts/run";
import { RunStatusBadge } from "@/features/runs/RunList";
import { RunStepRecord } from "@/features/runs/RunStepRecord";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { DiagnosticTrace } from "./DiagnosticTrace";
import { RunDiagnosticNextStep } from "./RunDiagnosticNextStep";
import { harnessConsoleHref, harnessRunDetailHref, HarnessNavigation } from "./harness-navigation";
import { contextStepAnchor } from "./run-context-navigation";
import { traceHistoryView } from "./trace-history-view";

const STEP_LABELS: Record<RunStepView["status"], string> = {
  pending: "待执行", running: "运行中", succeeded: "已完成", failed: "失败",
};

function formatDate(value: string | Date | null): string {
  if (!value) return "尚无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function RunDiagnostics({ run, steps, trace, historyTrace, contextSection, navigation, invalidTraceFilters = false }: { run: RunView; steps: RunStepView[] | null; trace: TraceEventView[] | null; historyTrace?: TraceEventView[] | null; contextSection?: ReactNode; navigation?: HarnessNavigation; invalidTraceFilters?: boolean }) {
  const failedSteps = steps?.filter((step) => step.status === "failed").length;
  const completedSteps = steps?.filter((step) => step.status === "succeeded").length;
  const attentionEvents = trace?.filter((event) => event.level !== "info").length;
  const scope = navigation ?? HarnessNavigation.parse({ runId: run.id });
  const historyMode = scope.trace.range === "history";
  const displayedTrace = historyMode ? historyTrace ?? null : trace;
  const historyView = historyMode && displayedTrace !== null && !invalidTraceFilters ? traceHistoryView(displayedTrace, scope.trace) : null;
  const historyPage = historyView ? {
    total: historyView.total, scopedCount: historyView.scopedCount, selectedCount: historyView.selectedCount,
    attentionCount: historyView.attentionCount, page: historyView.page, lastPage: historyView.lastPage,
    pagesLimited: historyView.pagesLimited, outOfRange: historyView.outOfRange,
  } : undefined;
  const recentHref = harnessConsoleHref({ ...scope, runId: run.id, trace: {
    query: scope.trace.query, nodeId: scope.trace.nodeId, attention: scope.trace.attention,
    ...(scope.trace.kind ? { kind: scope.trace.kind } : {}),
  } }, "diagnostic-trace");
  const historyHref = harnessConsoleHref({ ...scope, runId: run.id, trace: { ...scope.trace, range: "history", page: 1 } }, "diagnostic-trace");
  const traceStepOptions: Pick<RunStepView, "nodeId" | "nodeTitle">[] = steps === null ? [] : Array.from(new Map(steps.map((step) => [
    step.nodeId,
    { nodeId: step.nodeId, nodeTitle: step.nodeTitle },
  ])).values());

  return <div className="min-w-0 space-y-4">
    <section className="content-card min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">本次运行</p><h2 className="mt-1 break-words text-xl font-bold text-slate-950">{run.agentName}</h2><div className="mt-2 flex flex-wrap items-center gap-2"><RunStatusBadge status={run.status} /><span className="text-xs text-slate-500">{run.version === null ? "运行版本不可用" : `版本 ${run.version}`}</span></div></div><Link href={harnessRunDetailHref(run.id, undefined, navigation)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-700 hover:text-indigo-900">打开任务详情<ArrowRight className="size-4" /></Link></div>
      <p className="mt-4 text-xs leading-5 text-slate-500">开始：{formatDate(run.startedAt)}{run.finishedAt ? ` · 结束：${formatDate(run.finishedAt)}` : ""} · 北京时间</p>
      <a href={`/api/runs/${run.id}/export`} download className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900"><Download className="size-3.5" />下载运行报告</a>
      {run.error ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800"><p className="font-semibold">本次运行未完成的原因</p><p className="mt-1 whitespace-pre-wrap break-words">{redactSensitiveText(run.error)}</p></div> : null}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-slate-50 p-3"><ListChecks className="size-4 text-indigo-600" /><p className="mt-2 text-lg font-bold text-slate-950">{steps === null ? "—" : `${completedSteps}/${steps.length}`}</p><p className="text-xs text-slate-500">已完成步骤{steps === null ? " · 暂不可读" : ""}</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><CircleAlert className="size-4 text-red-600" /><p className="mt-2 text-lg font-bold text-slate-950">{failedSteps ?? "—"}</p><p className="text-xs text-slate-500">失败步骤{steps === null ? " · 暂不可读" : ""}</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><ShieldCheck className="size-4 text-amber-600" /><p className="mt-2 text-lg font-bold text-slate-950">{attentionEvents ?? "—"}</p><p className="text-xs text-slate-500">最近需关注事件{trace === null ? " · 暂不可读" : ""}</p></div>
      </div>
    </section>
    <RunDiagnosticNextStep run={run} navigation={navigation} />
    {contextSection}
    <section id="diagnostic-steps" tabIndex={-1} aria-labelledby="diagnostic-steps-title" className="content-card min-w-0 scroll-mt-24 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 id="diagnostic-steps-title" className="section-title">已保存的步骤</h2><p className="mt-1 text-sm text-slate-500">按真实步骤记录展示，不从流程草稿推测计划。</p></div><Link href={`${harnessRunDetailHref(run.id, undefined, navigation)}#steps`} className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">查看步骤数据</Link></div>
      {steps === null ? <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">步骤记录暂时无法读取。可重新读取状态，或在任务详情核对；下方轨迹如可用仍会显示。</p> : steps.length ? <ol className="mt-3 divide-y divide-slate-100">{steps.map((step) => <li key={step.id} id={contextStepAnchor(step.id)} tabIndex={-1} className="min-w-0 scroll-mt-24 py-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words text-sm font-medium text-slate-800">{step.nodeTitle ?? "未命名步骤"}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${step.status === "failed" ? "bg-red-50 text-red-700" : step.status === "succeeded" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{STEP_LABELS[step.status]}</span></div>
        <RunStepRecord step={step} />
      </li>)}</ol> : <p className="mt-3 text-sm text-slate-500">尚无步骤记录；可在任务详情查看当前状态。</p>}
    </section>
    {!invalidTraceFilters ? <nav aria-label="轨迹读取范围" className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs"><span className="font-medium text-slate-700">{historyMode ? "当前核对历史可读事件" : "当前核对最近事件"}</span>{historyMode ? <Link href={recentHref} prefetch={false} className="font-semibold text-indigo-700">返回最近事件</Link> : <Link href={historyHref} prefetch={false} className="font-semibold text-indigo-700">核对较早轨迹</Link>}</nav> : null}
    {historyMode && !invalidTraceFilters ? <p className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs leading-5 text-indigo-950">证据概览与上方最近需关注事件仍来自最近事件；下方历史范围独立读取，不保证是同一时刻。这里只核对按现有契约可解析的已保存事件，不保证所有原始记录都已纳入，也不代表规则判决。</p> : null}
    {invalidTraceFilters ? <DiagnosticTrace key={`${run.id}:invalid`} events={[]} stepOptions={traceStepOptions} navigation={scope} invalidFilters /> : displayedTrace === null ? <section id="diagnostic-trace" tabIndex={-1} aria-labelledby="diagnostic-trace-title" className="content-card scroll-mt-24 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500"><h2 id="diagnostic-trace-title" className="section-title">执行轨迹</h2><p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{historyMode ? "历史轨迹暂时无法读取，数量和内容未知，未按空记录或最近事件替代显示。其他分区如可读仍保留；可重新读取状态，或手动返回最近事件。" : "执行轨迹暂时无法读取，不能判断最近是否有需关注事件。可重新读取状态，或打开任务详情核对。"}</p></section> : <DiagnosticTrace key={`${run.id}:${JSON.stringify(scope.trace)}`} events={historyView?.events ?? displayedTrace} historyPage={historyPage} stepOptions={traceStepOptions} navigation={scope} />}
    {!historyMode && trace !== null && trace.length >= MAX_VISIBLE_TRACE_EVENTS ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">这里只展示最近 {MAX_VISIBLE_TRACE_EVENTS} 条轨迹。较早事件可在本页核对，也可从任务详情下载运行报告；报告按现有契约导出，不保证包含所有原始记录。</p> : null}
  </div>;
}
