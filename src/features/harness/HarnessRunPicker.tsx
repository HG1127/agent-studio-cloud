"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, ArrowRight, Search } from "lucide-react";
import type { RunSummary } from "@/contracts/run";
import { RunStatusBadge } from "@/features/runs/RunList";
import { HarnessNavigation, harnessConsoleHref, harnessParams, harnessRunHref } from "./harness-navigation";

export function HarnessRunPicker({ runs, selectedId, navigation = HarnessNavigation.parse({}), invalidFilters = false }: { runs: RunSummary[] | null; selectedId: string | null; navigation?: HarnessNavigation; invalidFilters?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(navigation.list.query);
  const [attentionOnly, setAttentionOnly] = useState(navigation.list.attention);
  const scope = { ...navigation, runId: selectedId ?? navigation.runId };
  const preserved = harnessParams({ ...scope, list: { query: "", attention: false } });
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => router.replace(harnessConsoleHref({ ...scope, list: { query, attention: attentionOnly } }), { scroll: false }));
  }
  function clear() {
    setQuery(""); setAttentionOnly(false);
    startTransition(() => router.replace(harnessConsoleHref({ ...scope, list: { query: "", attention: false } }), { scroll: false }));
  }
  const attentionRuns = runs?.filter((run) => ["failed", "waiting_approval", "waiting_event"].includes(run.status)) ?? [];
  const visible = runs?.filter((run) =>
    (!attentionOnly || attentionRuns.includes(run)) && run.agentName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ) ?? [];
  const selectedOutsideRecent = runs !== null && selectedId !== null && !runs.some((run) => run.id === selectedId);
  const selectedHidden = runs !== null && selectedId !== null && !selectedOutsideRecent && !visible.some((run) => run.id === selectedId);

  return <section aria-labelledby="diagnostic-runs-title" className="content-card min-w-0 self-start">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 id="diagnostic-runs-title" tabIndex={-1} className="section-title scroll-mt-24 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">最近的运行</h2><p className="mt-1 text-xs leading-5 text-slate-500">{runs === null ? "最近记录暂不可读，不能判断任务数量或状态。" : `仅列出最近 ${runs.length} 条；旧记录可从任务详情进入诊断。`}</p></div><Link href="/runs" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900">全部记录<ArrowRight className="size-3.5" /></Link></div>
    {selectedOutsideRecent ? <p className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-900">当前查看的任务不在下方最近记录中，诊断详情仍在右侧显示。</p> : null}
{invalidFilters ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p role="alert" className="text-sm leading-6 text-amber-950">最近任务筛选条件无效，未按全部任务替代显示。请清除无效筛选后继续核对。</p><button type="button" onClick={clear} disabled={pending} className="mt-2 text-sm font-semibold text-indigo-700">清除任务筛选</button></div> : runs === null ? <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">最近运行列表读取失败。已指定任务的诊断如可读取仍在右侧显示；可使用页面上方的“重新读取状态”，或前往全部记录核对。</div> : runs.length ? <>
      {selectedHidden ? <p className="mt-3 text-xs leading-5 text-indigo-800">所选任务被当前列表筛选隐藏，右侧仍是同一任务，不会自动切换。</p> : null}
      <form action="/harness" method="get" onSubmit={apply} aria-label="最近任务筛选" className="mt-4">
      {Array.from(preserved).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {attentionOnly ? <input type="hidden" name="runAttention" value="1" /> : null}
      <label className="relative block"><span className="sr-only">按助手名称筛选最近运行</span><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input type="search" name="runQuery" maxLength={100} disabled={pending} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索最近记录中的助手" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label>
      <div role="group" aria-label="筛选最近运行" className="mt-3 flex flex-wrap items-center gap-2 text-xs"><button type="button" aria-pressed={!attentionOnly} onClick={() => setAttentionOnly(false)} className={`rounded-lg px-3 py-1.5 font-semibold ${!attentionOnly ? "bg-indigo-50 text-indigo-800" : "bg-slate-100 text-slate-600"}`}>全部 {runs.length}</button><button type="button" aria-pressed={attentionOnly} onClick={() => setAttentionOnly(true)} className={`rounded-lg px-3 py-1.5 font-semibold ${attentionOnly ? "bg-indigo-50 text-indigo-800" : "bg-slate-100 text-slate-600"}`}>失败或等待 {attentionRuns.length}</button><span aria-live="polite" className="ml-auto text-slate-500">显示 {visible.length} 条</span></div>
      <div className="mt-3 flex flex-wrap items-center gap-2"><button type="submit" disabled={pending} aria-busy={pending} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">{pending ? "正在应用…" : "应用任务筛选"}</button>{query || attentionOnly ? <button type="button" disabled={pending} onClick={clear} className="px-2 py-2 text-xs font-semibold text-indigo-700">清除筛选</button> : null}</div>
      <p className="mt-2 text-xs leading-5 text-slate-500">应用后，重新读取或从任务详情返回会保留筛选。选择另一任务时保留任务列表范围，重置该任务的轨迹和快照筛选。</p>
      </form>
      {visible.length ? <nav aria-label="选择诊断任务" className="mt-3 max-h-[44rem] space-y-2 overflow-y-auto">
        {visible.map((run) => <Link key={run.id} href={harnessRunHref(run.id, { ...(run.id === selectedId ? scope : HarnessNavigation.parse({})), list: { query, attention: attentionOnly } })} prefetch={false} aria-current={run.id === selectedId ? "page" : undefined} className={`block rounded-xl border p-3 transition ${run.id === selectedId ? "border-indigo-300 bg-indigo-50/70" : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50"}`}><span className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 break-words text-sm font-semibold text-slate-900">{run.agentName}</span><RunStatusBadge status={run.status} /></span><span className="mt-1 block text-xs text-slate-500">{run.version === null ? "运行版本不可用" : `版本 ${run.version}`} · {run.startedAt ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(run.startedAt)) : "尚未开始"}</span></Link>)}
      </nav> : <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center"><p className="text-sm text-slate-600">最近记录中没有匹配的任务。</p></div>}
    </> : <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center"><Activity className="mx-auto size-6 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700">还没有运行记录</p><p className="mt-1 text-xs leading-5 text-slate-500">先运行一位已发布的助手，再到这里核对真实步骤和轨迹。</p><Link href="/agents" className="mt-3 inline-flex text-xs font-semibold text-indigo-700">选择助手</Link></div>}
  </section>;
}
