"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MAX_PAGE_NUMBER } from "@/lib/search-params";
import { MAX_VISIBLE_TRACE_EVENTS } from "@/contracts/run";
import type { RunStepView, TraceEventView } from "@/contracts/run";
import { HarnessNavigation, harnessConsoleHref, harnessParams } from "./harness-navigation";
import { TRACE_KIND_OPTIONS, traceKindCategory, traceKindLabel, type TraceKindFilter } from "./trace-kind-filter";
import { TRACE_HISTORY_PAGE_SIZE, type TraceHistoryPage } from "./trace-history-view";

function eventTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function DiagnosticTrace({ events, historyPage, stepOptions = [], navigation = HarnessNavigation.parse({}), invalidFilters = false }: { events: TraceEventView[]; historyPage?: TraceHistoryPage; stepOptions?: Pick<RunStepView, "nodeId" | "nodeTitle">[]; navigation?: HarnessNavigation; invalidFilters?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [attentionOnly, setAttentionOnly] = useState(navigation.trace.attention);
  const [nodeFilter, setNodeFilter] = useState(navigation.trace.nodeId);
  const [query, setQuery] = useState(navigation.trace.query);
  const [kind, setKind] = useState<TraceKindFilter>(navigation.trace.kind ?? "all");
  const [applyError, setApplyError] = useState<string | null>(null);
  const historyMode = navigation.trace.range === "history";
  const range = historyMode ? { range: "history" as const } : {};
  const preserved = harnessParams({ ...navigation, trace: { query: "", nodeId: "", attention: false, ...range } });
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = HarnessNavigation.safeParse({ ...navigation, trace: { query, nodeId: nodeFilter, attention: attentionOnly, ...(kind === "all" ? {} : { kind }), ...range, ...(historyMode ? { page: 1 } : {}) } });
    if (!next.success) { setApplyError("这组筛选条件无法保存在本页地址中。当前本地筛选仍保留，请缩短关键词、选择其他步骤或清除筛选；不会改成全部事件。"); return; }
    setApplyError(null);
    startTransition(() => router.replace(harnessConsoleHref(next.data, "diagnostic-trace"), { scroll: false }));
  }
  function clear() {
    setApplyError(null);
    setQuery(""); setNodeFilter(""); setAttentionOnly(false); setKind("all");
    startTransition(() => router.replace(harnessConsoleHref({ ...navigation, trace: { query: "", nodeId: "", attention: false, ...range, ...(historyMode ? { page: 1 } : {}) } }, "diagnostic-trace"), { scroll: false }));
  }
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  const scoped = events.filter((event) => (!nodeFilter || event.nodeId === nodeFilter)
    && (!keyword || `${event.title} ${event.detail ?? ""}`.toLocaleLowerCase("zh-CN").includes(keyword))
    && (kind === "all" || traceKindCategory(event.kind) === kind));
  const attentionCount = historyMode ? historyPage?.attentionCount ?? 0 : scoped.filter((event) => event.level !== "info").length;
  const scopedCount = historyMode ? historyPage?.scopedCount ?? 0 : scoped.length;
  const filterChanged = query !== navigation.trace.query || nodeFilter !== navigation.trace.nodeId
    || attentionOnly !== navigation.trace.attention || kind !== (navigation.trace.kind ?? "all");
  const history = historyMode ? historyPage : null;
  const visible = historyMode ? events : attentionOnly ? scoped.filter((event) => event.level !== "info") : scoped;
  const pageHref = (page: number) => harnessConsoleHref({ ...navigation, trace: { ...navigation.trace, page } }, "diagnostic-trace");

  if (historyMode && !historyPage && !invalidFilters) return <section id="diagnostic-trace" aria-labelledby="diagnostic-trace-title" className="content-card"><h2 id="diagnostic-trace-title" className="section-title">执行轨迹</h2><p role="alert" className="mt-3 text-sm text-amber-900">历史分页摘要暂时无法核对，不按最近事件或空记录替代显示。请重新读取状态。</p></section>;

  function returnToEvent(button: HTMLButtonElement) {
    const details = button.closest("details");
    if (!details) return;
    details.open = false;
    details.closest("li")?.focus();
  }

  if (invalidFilters) return <section id="diagnostic-trace" tabIndex={-1} aria-labelledby="diagnostic-trace-title" className="content-card min-w-0 scroll-mt-24"><h2 id="diagnostic-trace-title" className="section-title">执行轨迹</h2><p role="alert" className="mt-3 text-sm leading-6 text-amber-900">轨迹筛选条件无效，未按全部事件替代显示。其他任务证据仍可核对。</p><button type="button" disabled={pending} onClick={clear} className="mt-3 text-sm font-semibold text-indigo-700">清除轨迹筛选</button></section>;

  return <section id="diagnostic-trace" tabIndex={-1} aria-labelledby="diagnostic-trace-title" className="content-card min-w-0 scroll-mt-24">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="diagnostic-trace-title" className="section-title">执行轨迹</h2><p className="mt-1 text-sm leading-6 text-slate-500">只展示已保存的事件；“需关注”按事件级别筛选，不代表安全规则判决。</p></div>
      <div role="group" aria-label="筛选执行轨迹" className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button type="button" aria-pressed={!attentionOnly} onClick={() => setAttentionOnly(false)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${!attentionOnly ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>全部 {scopedCount}</button>
        <button type="button" aria-pressed={attentionOnly} onClick={() => setAttentionOnly(true)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${attentionOnly ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>需关注 {attentionCount}</button>
      </div>
    </div>
    <form action="/harness#diagnostic-trace" method="get" onSubmit={apply} onChange={() => setApplyError(null)} aria-label="已读取轨迹筛选">
    {Array.from(preserved).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    {attentionOnly ? <input type="hidden" name="traceAttention" value="1" /> : null}
    <fieldset className="mt-4" aria-describedby="harness-trace-kind-hint">
      <legend className="text-sm font-medium text-slate-700">事件类型</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {TRACE_KIND_OPTIONS.map((option) => <label key={option.value} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${kind === option.value ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600"}`}>
          <input type="radio" name="traceKind" value={option.value} checked={kind === option.value} disabled={pending} onChange={() => setKind(option.value)} className="accent-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500" />
          <span>{option.label}</span>
        </label>)}
      </div>
      <p id="harness-trace-kind-hint" className="mt-2 text-xs leading-5 text-slate-500">只按已保存的事件类型归类；其他与未知仍保留，不根据标题或级别推测规则命中与处理结论。</p>
    </fieldset>
    {stepOptions.length || nodeFilter ? <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"><label htmlFor="harness-trace-step" className="shrink-0 text-sm font-medium text-slate-700">查看关联步骤</label><select id="harness-trace-step" name="traceNode" disabled={pending} value={nodeFilter} onChange={(event) => setNodeFilter(event.target.value)} className="h-10 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"><option value="">全部事件</option>{nodeFilter && !stepOptions.some((step) => step.nodeId === nodeFilter) ? <option value={nodeFilter}>关联步骤不在当前可读清单中</option> : null}{stepOptions.map((step) => <option key={step.nodeId} value={step.nodeId}>{step.nodeTitle?.trim() || "未命名步骤"}</option>)}</select><p className="text-xs leading-5 text-slate-500 sm:max-w-56">仅按已保存的步骤关联字段筛选；运行级事件不属于单一步骤。</p></div> : null}
    {historyMode || events.length || query ? <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="min-w-0 flex-1"><span className="sr-only">搜索已读取的轨迹</span><input type="search" name="traceQuery" maxLength={100} disabled={pending} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={historyMode ? "搜索历史可读事件中的标题或说明" : "搜索最近轨迹中的标题或说明"} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label>
    </div> : null}
    <div className="mt-3 flex flex-wrap items-center gap-2"><button type="submit" disabled={pending} aria-busy={pending} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">{pending ? "正在应用…" : "应用轨迹筛选"}</button>{query || nodeFilter || attentionOnly || kind !== "all" ? <button type="button" disabled={pending} onClick={clear} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">清除轨迹筛选</button> : null}</div>
    <p className="mt-2 text-xs leading-5 text-slate-500">应用后会保留这组筛选，便于重新读取和任务详情往返；关键词会进入本页地址，请勿填写密钥或敏感业务内容。{historyMode ? "历史范围的填写只有应用后才重新读取并从第一页显示；当前仍是已读取的本页，不在浏览器猜测其他页内容。" : ""}</p>
    {applyError ? <p role="alert" className="mt-2 text-sm leading-6 text-amber-900">{applyError}</p> : null}
    </form>
    {history?.pagesLimited ? <p role="status" className="mt-2 text-xs leading-5 text-amber-900">此范围超过本页支持的 {MAX_PAGE_NUMBER} 页，更多可读事件没有逐页入口，不代表记录消失；可按步骤或关键词缩小范围，也可按实际响应核对运行报告。</p> : null}
    <p className="mt-2 text-xs leading-5 text-slate-500">{historyMode ? `历史范围按现有契约读取可解析的事件，每页最多显示 ${TRACE_HISTORY_PAGE_SIZE} 条；不保证所有原始记录都已纳入。翻页会重新读取，运行中的任务可能追加事件，不是固定历史快照，也没有完整规则判决。` : `这里仅核对最近最多 ${MAX_VISIBLE_TRACE_EVENTS} 条已读取事件，不代表完整历史，也没有规则判决或返工内容的结构化详情。`}</p>
    {history ? <p aria-live="polite" className="mt-2 text-xs leading-5 text-slate-500">本次读到 {history.total} 条可解析历史事件，筛选后 {history.selectedCount} 条；第 {history.page} 页显示 {visible.length} 条。读数不是所有原始记录的完整性保证。</p> : events.length ? <p aria-live="polite" className="mt-2 text-xs leading-5 text-slate-500">显示 {visible.length} / {events.length} 条已读取事件；搜索和筛选只作用于当前最近轨迹。</p> : null}
    {visible.length ? <ol aria-label="已保存的执行事件" className="mt-4 divide-y divide-slate-100">
      {visible.map((event) => <li key={event.id} id={`diagnostic-event-${event.seq}`} tabIndex={-1} aria-label={event.title} className="flex min-w-0 scroll-mt-24 gap-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">
        <span aria-hidden="true" className={`mt-1 size-2.5 shrink-0 rounded-full ${event.level === "error" ? "bg-red-500" : event.level === "warn" ? "bg-amber-500" : "bg-indigo-400"}`} />
        <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-slate-900">{event.title}</p>{event.detail ? <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{event.detail}</p> : null}<p className="mt-1 flex flex-wrap gap-x-2 text-xs text-slate-500"><span>{traceKindLabel(event.kind)}</span><span>{event.level === "error" ? "错误" : event.level === "warn" ? "提醒" : "记录"}</span><time dateTime={event.at}>{eventTime(event.at)} · 北京时间</time></p>
          <details aria-label={`${event.title}的记录信息`} className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">核对记录信息</summary>
            <p className="mt-2 leading-5 text-slate-700">已保存的记录顺序：第 {event.seq} 条</p>
            <p className="mt-1 break-words leading-5 text-slate-700">{event.nodeId === null ? "这是运行级事件，没有关联到单一步骤。" : stepOptions.some((step) => step.nodeId === event.nodeId) ? `已关联：${stepOptions.find((step) => step.nodeId === event.nodeId)?.nodeTitle?.trim() || "未命名步骤"}` : "有关联步骤，但名称未包含在当前步骤清单中。"}</p>
            <p className="mt-1 leading-5 text-slate-500">顺序和步骤关联来自已保存记录；事件级别不代表规则命中或审批结论。</p>
            <button type="button" onClick={(event) => returnToEvent(event.currentTarget)} className="mt-2 rounded-md px-2 py-1 font-semibold text-indigo-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">返回这条事件</button>
          </details>
        </div>
      </li>)}
    </ol> : <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{history ? history.outOfRange ? "这个历史页没有可读事件，不表示整个范围为空。请返回最后一页核对；不会切换到其他任务。" : history.total === 0 ? "本次读取没有可解析的历史事件，不保证原始记录为空。" : "当前历史可读范围中没有符合筛选条件的事件，可应用或清除筛选后继续核对。" : kind !== "all" ? "当前最近轨迹中没有符合所选类型与其他筛选条件的事件。可选全部类型或清除轨迹筛选。" : keyword ? "当前已读取的轨迹中没有符合关键词与筛选条件的事件。" : nodeFilter ? attentionOnly ? "所选步骤在最近轨迹中没有警告或错误事件。" : "所选步骤在最近轨迹中没有关联事件。" : attentionOnly ? "最近轨迹中没有警告或错误事件。" : "这次运行尚无已保存的轨迹事件。"}</p>}
    {history && (history.page > 1 || history.page < history.lastPage || filterChanged) ? <nav aria-label="历史轨迹分页" className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3 text-xs"><span className="text-slate-500">第 {history.page} 页，每页最多 {TRACE_HISTORY_PAGE_SIZE} 条</span>{filterChanged ? <p className="text-amber-800">当前填写尚未应用，请先应用轨迹筛选，再翻页。</p> : history.outOfRange ? <Link href={pageHref(history.lastPage)} prefetch={false} className="font-semibold text-indigo-700">返回历史最后一页</Link> : <>{history.page > 1 ? <Link href={pageHref(history.page - 1)} prefetch={false} className="font-semibold text-indigo-700">历史上一页</Link> : null}{history.page < history.lastPage ? <Link href={pageHref(history.page + 1)} prefetch={false} className="font-semibold text-indigo-700">历史下一页</Link> : null}</>}</nav> : null}
  </section>;
}
