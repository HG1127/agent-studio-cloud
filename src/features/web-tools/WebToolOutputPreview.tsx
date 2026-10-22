"use client";

import { useId, useState } from "react";
import { FileOutput, LayoutGrid, ListChecks } from "lucide-react";
import type { AgentManifest } from "@/contracts/manifest";
import { webToolOutputLabel } from "./web-tool-field-label";

export function WebToolOutputPreview({ fields }: { fields: NonNullable<AgentManifest["outputContract"]>["fields"] }) {
  const id = useId();
  const [view, setView] = useState<"cards" | "list">("cards");

  return <section aria-labelledby={`${id}-title`} className="content-card min-w-0 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><FileOutput aria-hidden="true" className="size-4" /></span><div><h2 id={`${id}-title`} className="section-title">交付布局预览</h2><p className="mt-1 text-sm leading-6 text-slate-600">按已保存字段的顺序核对展示位置；下方没有运行结果，也没有生成演示内容。</p></div></div>
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">仅本页预览</span>
    </div>
    {fields.length > 0 ? <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-600">本版本共 {fields.length} 项交付，其中 {fields.filter((field) => field.required).length} 项需要交付。</p><div role="group" aria-label="交付布局" className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">{[{ value: "cards" as const, label: "字段卡片", Icon: LayoutGrid }, { value: "list" as const, label: "交付清单", Icon: ListChecks }].map(({ value, label, Icon }) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${view === value ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}><Icon aria-hidden="true" className="size-3.5" />{label}</button>)}</div></div>
      <ol aria-label="本版本交付布局" className={view === "cards" ? "grid gap-3 lg:grid-cols-2" : "divide-y divide-slate-100 rounded-xl border border-slate-200"}>{fields.map((field, index) => <li key={`${index}:${field.path}`} className={view === "cards" ? "min-w-0 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4" : "flex min-w-0 flex-wrap items-start justify-between gap-3 p-4"}><div className="min-w-0"><p className="break-words text-sm font-semibold text-slate-800"><span className="mr-2 text-xs text-slate-400">{index + 1}.</span>{webToolOutputLabel(field, index)}</p><p className="mt-2 text-xs leading-5 text-slate-500">仅占位，尚无网页调用结果</p></div><span className="mt-2 inline-flex rounded-full bg-white px-2 py-1 text-xs font-medium text-slate-500">{field.required ? "需要交付" : "可选交付"}</span></li>)}</ol>
      <p className="text-xs leading-5 text-slate-500">布局切换不会修改字段、保存展示配置或发布工具；当前契约未定义结果类型，不能推断评分、图表或报告内容。</p>
    </> : <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">所选已保存版本没有定义结构化交付字段，无法预览交付布局；这不代表无需交付结果。</p>}
  </section>;
}
