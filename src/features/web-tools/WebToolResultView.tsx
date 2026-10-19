"use client";

import { useState, type ReactNode } from "react";
import { CopyResultButton } from "@/features/runs/CopyResultButton";
import { StructuredRunValue } from "@/features/runs/StructuredRunValue";
import type { savedRunResultView } from "@/features/runs/run-result-view";

export function WebToolResultView({ result, valuePreviews }: { result: ReturnType<typeof savedRunResultView>; valuePreviews?: readonly ReactNode[] }) {
  const [view, setView] = useState<"cards" | "list">("cards");
  if (result.unavailable) return <p role="alert" className="text-sm leading-6 text-amber-900">{result.message}</p>;
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="已保存结果布局" className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {([{ value: "cards", label: "字段卡片" }, { value: "list", label: "交付清单" }] as const).map(({ value, label }) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`rounded-md px-3 py-2 text-xs font-semibold ${view === value ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}>{label}</button>)}
      </div>
      <CopyResultButton result={result.redactedResult} text={result.copyText} label="复制已保存内容" />
    </div>
    {result.outputs.length ? <ul aria-label="已保存的交付内容" className={view === "cards" ? "grid min-w-0 gap-4 lg:grid-cols-2" : "min-w-0 divide-y divide-slate-200 rounded-xl border border-slate-200"}>
      {result.outputs.map(({ key, label, output }, index) => <li key={`${index}:${key}`} className="min-w-0 space-y-3 rounded-xl bg-slate-50/60 p-4"><h4 className="break-words text-sm font-semibold text-slate-900">{label}</h4>{valuePreviews && index in valuePreviews ? valuePreviews[index] : <StructuredRunValue value={output} maxEntries={20} />}<CopyResultButton result={output} label={`复制${label}`} /></li>)}
    </ul> : <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">已保存的结果为空对象，没有可展示的交付内容。请结合任务步骤核对。</p>}
    <details className="min-w-0"><summary className="cursor-pointer text-sm text-slate-500">查看已保存结果（开发者数据）</summary><pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">{JSON.stringify(result.redactedResult, null, 2)}</pre></details>
  </div>;
}
