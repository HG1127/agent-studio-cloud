"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type { RunModelUsage } from "@/contracts/model-usage";
import type { RunModelUsageChain } from "@/contracts/model-usage-chain";
import { ChainModelUsageSummary, SingleModelUsageSummary } from "./ModelUsageSummary";
import { readRunModelUsage, readRunModelUsageChain } from "./model-usage-client";

type ReadState<T> = { status: "loading" } | { status: "error" } | { status: "ready"; summary: T };

export function RunModelUsagePanel({ runId }: { runId: string }) {
  return <UsageReader key={runId} runId={runId} />;
}

function UsageReader({ runId }: { runId: string }) {
  const [current, setCurrent] = useState<ReadState<RunModelUsage>>({ status: "loading" });
  const [chain, setChain] = useState<ReadState<RunModelUsageChain>>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const [slow, setSlow] = useState(false);
  const loading = current.status === "loading" || chain.status === "loading";
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => { if (active) setSlow(true); }, 10_000);
    void readRunModelUsage(runId, controller.signal).then(
      (summary) => { if (active) setCurrent({ status: "ready", summary }); },
      () => { if (active) setCurrent({ status: "error" }); },
    );
    void readRunModelUsageChain(runId, controller.signal).then(
      (summary) => { if (active) setChain({ status: "ready", summary }); },
      () => { if (active) setChain({ status: "error" }); },
    );
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [runId, revision]);

  return <section id="model-usage" aria-labelledby="model-usage-title" className="content-card scroll-mt-32 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="eyebrow">运行证据</p><h2 id="model-usage-title" className="section-title mt-1">模型调用与用量</h2></div>
      <button type="button" disabled={loading && !slow} aria-busy={loading} onClick={() => {
        setSlow(false); setCurrent({ status: "loading" }); setChain({ status: "loading" }); setRevision((value) => value + 1);
      }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400">
        <RefreshCw aria-hidden className={"size-4 " + (loading ? "motion-safe:animate-spin" : "")} />{loading && !slow ? "正在读取用量…" : "重新读取用量"}
      </button>
    </div>
    <p className="text-sm leading-6 text-slate-600">分别核对当前任务与已纳入协作链的真实统计。两种范围包含重叠任务，不能把它们相加。</p>
    <p className="text-xs leading-6 text-slate-500">用量单位为模型报告的文本计量单位，不是字符数、上下文占用或费用。这里只在打开分区和手动重新读取时更新，不自动轮询、不重新执行任务；未知不等于零。</p>
    {loading && slow ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">部分统计读取较慢，可继续等待或重新读取用量。重新读取只取消本页旧统计请求，不取消任务、不重发业务操作。</p> : null}
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <article aria-labelledby="current-model-usage-title" aria-busy={current.status === "loading"} className="min-w-0 rounded-2xl border border-slate-200 p-4">
        <h3 id="current-model-usage-title" className="font-semibold text-slate-900">当前任务自身</h3>
        {current.status === "loading" ? <UsageLoading /> : current.status === "error" ? <UsageError scope="当前任务" /> : <SingleModelUsageSummary summary={current.summary} />}
      </article>
      <article aria-labelledby="chain-model-usage-title" aria-busy={chain.status === "loading"} className="min-w-0 rounded-2xl border border-slate-200 p-4">
        <h3 id="chain-model-usage-title" className="font-semibold text-slate-900">已纳入的协作链</h3>
        {chain.status === "loading" ? <UsageLoading /> : chain.status === "error" ? <UsageError scope="协作链" /> : <ChainModelUsageSummary summary={chain.summary} />}
      </article>
    </div>
  </section>;
}

function UsageLoading() {
  return <p aria-live="polite" className="mt-4 flex items-start gap-2 text-sm leading-6 text-slate-500"><LoaderCircle aria-hidden className="mt-1 size-4 shrink-0 motion-safe:animate-spin" />正在读取真实统计，尚不能判断调用数量或用量。</p>;
}

function UsageError({ scope }: { scope: string }) {
  return <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">{scope}用量暂时无法读取或核对，不能当作零调用或零用量。其他已读到的任务内容仍可使用；可重新读取用量，不会重发业务操作。</p>;
}
