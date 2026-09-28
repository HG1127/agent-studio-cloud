"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, PlugZap, Search, ShieldAlert } from "lucide-react";
import type { ToolRegistryOption } from "@/contracts/tool-registry";

const riskOptions = [
  { value: "all", label: "全部风险" },
  { value: "low", label: "低风险" },
  { value: "medium", label: "中风险" },
  { value: "high", label: "高风险" },
] as const;
type RiskFilter = typeof riskOptions[number]["value"];

const riskLabels = { low: "低风险", medium: "中风险", high: "高风险" } as const;
const riskClasses = {
  low: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
  medium: "bg-amber-50 text-amber-800 ring-amber-600/10",
  high: "bg-rose-50 text-rose-700 ring-rose-600/10",
} as const;

type CatalogTool = Pick<ToolRegistryOption, "id" | "name" | "description" | "risk">;

export function ToolCatalog({ tools }: { tools: CatalogTool[] }) {
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("zh-CN");
    return tools.filter((tool) => (risk === "all" || tool.risk === risk)
      && (!text || `${tool.name} ${tool.description}`.toLocaleLowerCase("zh-CN").includes(text)));
  }, [tools, query, risk]);

  return <section id="business-tools" aria-labelledby="business-tools-title" className="content-card scroll-mt-32">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><PlugZap className="size-4" /></span><h2 id="business-tools-title" className="section-title">业务工具目录</h2></div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">这里只列出管理员已登记、可在流程设计中选择的工具。登记不代表连接已验证或已获授权；实际运行仍可能因连接或权限问题失败。</p>
      </div>
      <span className="w-fit shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">已登记 {tools.length} 项</span>
    </div>
    {tools.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center">
      <PlugZap className="mx-auto size-7 text-slate-400" />
      <p className="mt-3 text-sm font-semibold text-slate-700">当前没有已登记的业务工具</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">请联系管理员登记实际使用的业务工具。演示工具只用于检查流程结构，不连接公司系统。</p>
    </div> : <>
      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <label className="relative block w-full lg:max-w-sm">
          <span className="sr-only">搜索业务工具</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工具名称或用途" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
        </label>
        <div role="group" aria-label="按风险筛选工具" className="flex flex-wrap gap-1.5">
          {riskOptions.map((option) => <button key={option.value} type="button" aria-pressed={risk === option.value} onClick={() => setRisk(option.value)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${risk === option.value ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{option.label}</button>)}
        </div>
      </div>
      <p role="status" className="mt-3 text-xs text-slate-500">当前显示 {filtered.length} / {tools.length} 项已登记工具</p>
      {filtered.length === 0 ? <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">没有符合条件的工具。请调整关键词或风险筛选。</div> : <ul className="mt-3 grid gap-3 lg:grid-cols-2">
        {filtered.map((tool) => <li key={tool.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 break-words font-semibold text-slate-900">{tool.name}</h3><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${riskClasses[tool.risk]}`}><ShieldAlert aria-hidden="true" className="mr-1 inline size-3.5" />{riskLabels[tool.risk]}</span></div>
          <p className="mt-2 break-words text-sm leading-6 text-slate-600">{tool.description || "管理员尚未填写用途说明；使用前请在流程中核对输入和结果。"}</p>
          <p className="mt-3 text-xs text-slate-500">已登记 · 连接状态未在此处验证</p>
        </li>)}
      </ul>}
      <Link href="/agents" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-700 hover:text-indigo-900">前往助手流程设计<ArrowRight className="size-4" /></Link>
    </>}
  </section>;
}
