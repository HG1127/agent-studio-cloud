"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, History, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EvaluationRunView } from "@/contracts/evaluation";
import { EvaluationRunEvidence } from "./EvaluationRunEvidence";
import { EvaluationReviewNavigation, evaluationReviewHref } from "./evaluation-review-navigation";
import { evaluationBatchIssues, evaluationBatchVerdict, evaluationResultPage } from "./evaluation-review-view";
import { acceptanceHistoryHref, type AcceptanceOverviewScope } from "@/features/quality/acceptance-evidence-navigation";

const RESULT_LABEL = { running: "运行中", passed: "通过", failed: "未通过" } as const;
const BATCH_LABEL = { running: "运行中", passed: "汇总通过", failed: "未通过", unknown: "结果待核对" } as const;

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "开始时间暂不可读" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date) + "（北京时间）";
}

export function EvaluationHistory({ agentId, runs, navigation, invalidNavigation = false, hasMoreRuns = false, overviewScope }: {
  agentId: string; runs: EvaluationRunView[]; navigation: EvaluationReviewNavigation;
  invalidNavigation?: boolean; hasMoreRuns?: boolean; overviewScope?: AcceptanceOverviewScope;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [queryDraft, setQueryDraft] = useState({ applied: navigation.query, value: navigation.query });
  const query = queryDraft.applied === navigation.query ? queryDraft.value : navigation.query;
  const focusTarget = useRef<HTMLElement | null>(null);
  const selected = !invalidNavigation && navigation.batchId ? runs.find((run) => run.id === navigation.batchId) : null;
  const [batchBrowser, setBatchBrowser] = useState<{ batchId?: string; open: boolean }>({ open: false });
  const browsing = batchBrowser.batchId === navigation.batchId && batchBrowser.open;
  const visibleBatches = selected && !browsing ? [selected] : runs;
  const page = selected ? evaluationResultPage(selected, navigation) : null;
  const selectedCases = selected?.results.filter((result) => result.caseId === navigation.caseId) ?? [];
  const selectedCase = selectedCases.length === 1 ? selectedCases[0] : null;
  const issues = selected ? evaluationBatchIssues(selected) : [];
  const historyHref = (next: EvaluationReviewNavigation) => overviewScope ? acceptanceHistoryHref(agentId, next, overviewScope) : evaluationReviewHref(agentId, next);
  function go(next: EvaluationReviewNavigation) {
    startTransition(() => router.replace(historyHref(next), { scroll: false }));
  }
  const clean = { ...EvaluationReviewNavigation.parse({}), versionsPage: navigation.versionsPage, archivedCasesPage: navigation.archivedCasesPage, evaluationRunsPage: navigation.evaluationRunsPage };
  const closeEvidence = () => go({ ...navigation, caseId: undefined });

  return <aside aria-labelledby="evaluation-history-title" aria-busy={pending} className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
    <div className="flex items-start justify-between gap-3"><div><h3 id="evaluation-history-title" className="text-sm font-semibold text-slate-900">验收记录</h3><p className="mt-1 text-xs leading-5 text-slate-500">选择一轮验收，筛选问题样例，再核对实际运行证据。</p></div><History aria-hidden className="size-4 shrink-0 text-slate-400" /></div>
    {pending ? <p role="status" className="text-xs text-indigo-700">正在读取所选记录；没有提交验收。</p> : null}
    {invalidNavigation ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><p>验收定位或筛选条件无效，未自动选择其他批次或样例。</p><Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => go(clean)}>清除验收定位与筛选</Button></div> : null}
    {selected && runs.length > 1 ? <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">本页共 {runs.length} 轮，正在核对所选一轮。</p><Button type="button" variant="ghost" size="sm" onClick={() => setBatchBrowser({ batchId: navigation.batchId, open: !browsing })}>{browsing ? "收起其他批次" : "切换本页验收批次"}</Button></div> : null}
    {runs.length ? <div role="group" aria-label="本页验收批次" className="grid gap-2">{visibleBatches.map((run) => {
      const verdict = evaluationBatchVerdict(run);
      const needsReview = evaluationBatchIssues(run).length > 0;
      const active = selected?.id === run.id;
      return <article key={run.id} aria-label={`验收批次：版本 ${run.version}，${formatTime(run.startedAt)}`} className={`min-w-0 rounded-xl border bg-white p-3 ${active ? "border-indigo-300 ring-1 ring-indigo-100" : "border-slate-200"}`}>
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900">版本 {run.version}</p><p className="mt-1 text-xs text-slate-500">{formatTime(run.startedAt)}</p></div><Badge tone={verdict === "running" ? "info" : verdict === "failed" ? "danger" : verdict === "passed" && !needsReview ? "success" : "warning"}>{BATCH_LABEL[verdict]}{verdict === "passed" && needsReview ? " · 证据待核对" : ""}</Badge></div>
        <p className="mt-2 text-xs text-slate-600">通过 {run.passedCount} / 失败 {run.failedCount} / 共 {run.totalCount}</p>
        {active ? <p aria-current="true" className="mt-3 text-xs font-semibold text-indigo-700">正在核对这一轮</p> : <Link prefetch={false} scroll={false} href={historyHref({ ...clean, batchId: run.id })} className="mt-3 inline-block rounded-md text-xs font-semibold text-indigo-700 hover:text-indigo-900 focus-visible:ring-2 focus-visible:ring-indigo-400">核对这一轮样例</Link>}
      </article>;
    })}</div> : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center"><Clock3 aria-hidden className="mx-auto size-5 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700">{navigation.evaluationRunsPage > 1 ? "这一页没有验收记录" : "还没有验收记录"}</p><p className="mt-1 text-xs leading-5 text-slate-500">{navigation.evaluationRunsPage > 1 ? "可以返回上一页；不能据此判断从未验收。" : "准备样例并运行验收后，这里会保留逐项判定。"}</p></div>}
    {navigation.evaluationRunsPage > 1 || hasMoreRuns ? <nav aria-label="验收记录分页" className="flex items-center justify-between gap-3 text-xs">{navigation.evaluationRunsPage > 1 ? <Link prefetch={false} scroll={false} href={historyHref({ ...clean, evaluationRunsPage: navigation.evaluationRunsPage - 1 })} className="font-semibold text-indigo-700">上一页</Link> : <span />}<span className="text-slate-500">第 {navigation.evaluationRunsPage} 页</span>{hasMoreRuns ? <Link prefetch={false} scroll={false} href={historyHref({ ...clean, evaluationRunsPage: navigation.evaluationRunsPage + 1 })} className="font-semibold text-indigo-700">下一页</Link> : <span />}</nav> : null}
    {!invalidNavigation && navigation.batchId && !selected ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><p>本页未读到所选批次，没有自动换成最新验收。可回到原页核对，或清除定位后重新选择。</p><Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => go(clean)}>清除验收定位与筛选</Button></div> : null}
    {selected && page ? <section aria-label="所选验收的样例判定" tabIndex={-1} ref={(element) => { if (!focusTarget.current?.isConnected) focusTarget.current = element; }} className="min-w-0 space-y-3 border-t border-slate-200 pt-4">
      <div><h4 className="text-sm font-semibold text-slate-900">版本 {selected.version} · 样例判定</h4><p className="mt-1 text-xs leading-5 text-slate-500">筛选仅作用于所选批次的已读判定，不修改结果，也不代表历史评分。</p></div>
      {issues.length ? <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">证据需要核对</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-amber-900">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
      <form onSubmit={(event) => { event.preventDefault(); go({ ...navigation, query, samplePage: 1 }); }} className="flex items-end gap-2"><label className="grid min-w-0 flex-1 gap-1.5 text-xs font-medium text-slate-600">按样例名称查找<input aria-label="按样例名称查找" value={query} maxLength={100} onChange={(event) => setQueryDraft({ applied: navigation.query, value: event.target.value })} className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label><Button type="submit" size="sm" variant="secondary" disabled={pending}><Search aria-hidden className="size-3.5" />查找</Button></form>
      <p className="text-xs leading-5 text-slate-500">查找词会保存在地址中，请勿填写密钥或敏感业务内容。</p>
      <div role="group" aria-label="样例判定筛选" className="flex flex-wrap gap-1.5">{(["all", "failed", "passed", "running"] as const).map((status) => <button key={status} type="button" disabled={pending} aria-pressed={navigation.status === status} onClick={() => go({ ...navigation, status, samplePage: 1 })} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${navigation.status === status ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}>{status === "all" ? "全部判定" : RESULT_LABEL[status]}</button>)}</div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><p role="status" className="text-slate-500">已读 {selected.results.length} 条，匹配 {page.matching.length} 条{page.visible.length ? `；本页 ${page.start + 1}–${page.start + page.visible.length} 条` : ""}</p>{navigation.query || navigation.status !== "all" || navigation.samplePage !== 1 ? <button type="button" onClick={() => go({ ...navigation, query: "", status: "all", samplePage: 1 })} className="font-semibold text-indigo-700">清除样例筛选</button> : null}</div>
      {navigation.caseId && !selectedCase ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">所选样例未读到或存在重复记录，未打开其他运行的证据。<button type="button" onClick={closeEvidence} className="ml-1 font-semibold underline">清除样例定位</button></p> : null}
      {selectedCase && !page.visible.some((result) => result.caseId === selectedCase.caseId) ? <p role="status" className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800">当前核对的样例不在筛选后的本页中；证据仍对应原样例，未自动切换。</p> : null}
      {page.visible.length ? <ul aria-label="本页样例判定" className="space-y-2">{page.visible.map((result, index) => {
        const duplicate = selected.results.filter((item) => item.caseId === result.caseId).length !== 1;
        return <li key={`${index}:${result.caseId}`} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words text-sm font-semibold text-slate-900">{result.caseName}</p><Badge tone={result.status === "failed" ? "danger" : result.status === "passed" ? "success" : "info"}>{RESULT_LABEL[result.status]}</Badge></div>{result.error ? <p className="mt-2 break-words text-xs leading-5 text-red-700">{result.error}</p> : null}{duplicate ? <p className="mt-2 text-xs text-amber-800">重复记录，暂不能定位证据。</p> : result.runId ? <Link ref={(element) => { if (navigation.caseId === result.caseId && element) focusTarget.current = element; }} prefetch={false} scroll={false} href={historyHref({ ...navigation, caseId: result.caseId })} className="mt-2 inline-block rounded-md text-xs font-semibold text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400">核对运行证据</Link> : <p className="mt-2 text-xs text-slate-500">此判定未关联运行记录。可能尚未启动或启动未成功，不能伪造执行证据。</p>}</li>;
      })}</ul> : <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-xs leading-5 text-slate-500">{selected.results.length === 0 ? "尚未读到逐项判定，请结合汇总状态重新读取。" : page.matching.length === 0 ? "当前条件没有匹配的样例，可清除筛选。" : "这一页没有匹配记录，可返回上一页；筛选和定位未被自动重置。"}</p>}
      {navigation.samplePage > 1 || page.hasMore ? <nav aria-label="样例判定分页" className="flex items-center justify-between gap-3 text-xs">{navigation.samplePage > 1 ? <Link prefetch={false} scroll={false} href={historyHref({ ...navigation, samplePage: navigation.samplePage - 1 })} className="font-semibold text-indigo-700">上一页</Link> : <span />}<span className="text-slate-500">第 {navigation.samplePage} 页</span>{page.hasMore ? <Link prefetch={false} scroll={false} href={historyHref({ ...navigation, samplePage: navigation.samplePage + 1 })} className="font-semibold text-indigo-700">下一页</Link> : <span />}</nav> : null}
      {selectedCase?.runId ? <EvaluationRunEvidence key={`${selected.id}:${selectedCase.caseId}:${selectedCase.runId}:${selected.version}`} agentId={agentId} version={selected.version} result={selectedCase} navigation={navigation} onClose={closeEvidence} returnFocusRef={focusTarget} overviewScope={overviewScope} /> : null}
    </section> : null}
  </aside>;
}
