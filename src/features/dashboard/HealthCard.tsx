"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HealthResponse, type Health } from "@/contracts/health";

const LABELS: Record<keyof Health, string> = {
  ok: "整体状态",
  db: "数据库",
  workflow: "执行引擎",
};

const HEALTHY_DETAILS: Record<keyof Health, string> = {
  ok: "创建、运行与保存所需服务均通过检查",
  db: "工作区数据可以正常读取和保存",
  workflow: "运行、等待与继续处理能力正常",
};

const ATTENTION_DETAILS: Record<keyof Health, string> = {
  ok: "有服务未通过本次检查",
  db: "数据检查未通过；以页面实际读取结果为准",
  workflow: "运行与审批能力需要再次确认",
};

type HealthState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; health: Health };

export function HealthCard() {
  const [state, setState] = useState<HealthState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    fetch("/api/health", { signal: controller.signal })
      .then((r) => r.json())
      .then((data: unknown) => {
        if (!active) return;
        const parsed = HealthResponse.safeParse(data);
        setState(
          parsed.success ? { phase: "ready", health: parsed.data } : { phase: "error" },
        );
      })
      .catch(() => {
        if (active) setState({ phase: "error" });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  if (state.phase === "loading") {
    return <div aria-live="polite" aria-busy="true" className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex items-start gap-3"><LoaderCircle aria-hidden="true" className="mt-0.5 size-5 animate-spin text-indigo-500" /><div><p className="text-sm font-semibold text-slate-800">正在检查系统状态</p><p className="mt-1 text-xs leading-5 text-slate-500">正在确认数据与执行服务，页面中的其他内容可以继续查看。</p></div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3" aria-hidden="true"><span className="h-20 animate-pulse rounded-xl bg-slate-200/70" /><span className="h-20 animate-pulse rounded-xl bg-slate-200/70" /><span className="h-20 animate-pulse rounded-xl bg-slate-200/70" /></div>
    </div>;
  }
  if (state.phase === "error") {
    return (
      <div role="status" className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-200 text-slate-600"><AlertTriangle aria-hidden="true" className="size-5" /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">系统状态暂未确认</p><p className="mt-1 text-xs leading-5 text-slate-500">状态读取失败不代表任务或数据已经丢失；你可以继续查看已加载内容，稍后再检查。</p></div>
        <Button type="button" variant="secondary" size="sm" onClick={() => { setState({ phase: "loading" }); setAttempt((value) => value + 1); }}>
          <RefreshCw aria-hidden="true" className="size-3.5" />重新检查
        </Button>
      </div>
    );
  }
  const requiresAttention = !state.health.ok;
  return <div className="space-y-3">
    <div role="status" className={`flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center ${requiresAttention ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${requiresAttention ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
        {requiresAttention ? <AlertTriangle aria-hidden="true" className="size-5" /> : <CheckCircle2 aria-hidden="true" className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${requiresAttention ? "text-amber-950" : "text-emerald-950"}`}>{requiresAttention ? "部分服务需要检查" : "所有服务检查通过"}</p>
        <p className={`mt-1 text-xs leading-5 ${requiresAttention ? "text-amber-800" : "text-emerald-800"}`}>{requiresAttention ? "本次检查未全部通过。页面中已成功读取的数据仍可查看，启动新任务前建议重新检查。" : "数据与执行服务均已响应，可以继续创建和运行任务。"}</p>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={() => { setState({ phase: "loading" }); setAttempt((value) => value + 1); }}>
        <RefreshCw aria-hidden="true" className="size-3.5" />重新检查
      </Button>
    </div>
    <dl className="grid w-full gap-3 sm:grid-cols-3">
      {(Object.keys(LABELS) as (keyof Health)[]).map((key) => (
        <div key={key} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <dt className="text-xs font-medium text-slate-500">{LABELS[key]}</dt>
          <dd className={`mt-2 flex items-center gap-2 text-sm font-semibold ${state.health[key] ? "text-emerald-700" : "text-amber-700"}`}>
            <span aria-hidden="true" className={`size-2 rounded-full ${state.health[key] ? "bg-emerald-500" : "bg-amber-500"}`} />
            {state.health[key] ? "正常" : "需要检查"}
          </dd>
          <p className="mt-2 text-xs leading-5 text-slate-500">{state.health[key] ? HEALTHY_DETAILS[key] : ATTENTION_DETAILS[key]}</p>
        </div>
      ))}
    </dl>
  </div>;
}
