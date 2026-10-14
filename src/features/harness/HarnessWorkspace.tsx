"use client";

import { Activity, Gauge, Settings2, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { WorkspaceTabs } from "@/components/ui/WorkspaceTabs";
import { Card } from "@/components/ui/card";
import type { RunSummary } from "@/contracts/run";
import type { HarnessPolicyReadResult } from "@/contracts/harness-management";
import { RuntimeDefaultsDraft, RuleConditionsDraft } from "./RuntimeDefaultsDraft";

function readableCount(value: number | null): string {
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? String(value) : "暂未知";
}

export function HarnessWorkspace({ diagnostics, rules, resources, runs, policy }: {
  diagnostics: ReactNode;
  rules: ReactNode;
  resources: ReactNode;
  runs: RunSummary[] | null;
  policy: HarnessPolicyReadResult;
}) {
  const [tab, setTab] = useState("diagnostics");
  const runCount = runs === null ? null : runs.length;
  const attentionCount = runs === null ? null : runs.filter((run) => run.status === "failed" || run.status === "waiting_approval" || run.status === "waiting_event").length;
  const ruleCount = policy.ok ? policy.policy.policy?.rules.length ?? 0 : null;
  return <div className="min-w-0 space-y-6">
    <section aria-label="运行概况" className="grid min-w-0 grid-cols-3 gap-4">
      <Card className="min-w-0 p-5">
        <p className="text-xs font-medium text-slate-500">最近可读运行</p>
        <p className="mt-2 text-2xl font-semibold text-slate-950">{readableCount(runCount)}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">仅本次页面可读范围，不是全部历史数量。</p>
      </Card>
      <button type="button" onClick={() => setTab("diagnostics")} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm outline-none hover:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-300">
        <span className="text-xs font-medium text-slate-500">最近待处理</span>
        <span className="mt-2 block text-2xl font-semibold text-amber-700">{readableCount(attentionCount)}</span>
        <span className="mt-2 block text-xs leading-5 text-slate-500">最近可读范围内失败、待确认或等待继续条件的任务。打开运行诊断查看。</span>
      </button>
      <button type="button" onClick={() => setTab("rules")} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm outline-none hover:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-300">
        <span className="text-xs font-medium text-slate-500">本次可读安全规则</span>
        <span className="mt-2 block text-2xl font-semibold text-slate-950">{readableCount(ruleCount)}</span>
        <span className="mt-2 block text-xs leading-5 text-slate-500">当前附加规则，不含管理员规则；读取失败时保留未知。</span>
      </button>
    </section>
    <WorkspaceTabs label="运行管理功能" value={tab} onValueChange={setTab} tabs={[
      { id: "diagnostics", label: "运行诊断", icon: <Activity className="size-4" />, description: "找到任务，查看步骤、等待原因与已有运行证据。", content: diagnostics },
      { id: "defaults", label: "默认运行规则", icon: <Settings2 className="size-4" />, description: "先设计失败处理、记忆和质量检查。统一默认规则目前只提供本页草稿。", content: <RuntimeDefaultsDraft /> },
      { id: "rules", label: "安全规则", icon: <ShieldCheck className="size-4" />, description: "已有精确允许、阻止规则使用真实接口；其他处理方式和身份环境条件仅供本地设计。", content: <div className="min-w-0 space-y-6">{rules}<RuleConditionsDraft /></div> },
      { id: "resources", label: "资源限额", icon: <Gauge className="size-4" />, description: "查看并管理系统已有的执行限额，实际状态以接口回执为准。", content: resources },
    ]} />
  </div>;
}
