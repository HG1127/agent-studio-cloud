import Link from "next/link";
import type { DashboardSummary } from "@/contracts/dashboard";
import type { AgentSummary } from "@/contracts/agent";
import type { RunSummary } from "@/contracts/run";
import { RunList } from "@/features/runs/RunList";
import { Activity, AlertTriangle, ArrowRight, Bot, CheckCircle2, ChevronRight, Clock3, Database, Sparkles } from "lucide-react";

function nextActionFor(summary: DashboardSummary) {
  if (summary.failuresLast24h > 0) return {
    eyebrow: "优先处理",
    title: `近 24 小时有 ${summary.failuresLast24h} 次运行失败`,
    description: "查看失败原因和已保留的处理记录，再决定是否重新运行。",
    action: "查看失败记录",
    href: "/runs?status=failed",
    icon: AlertTriangle,
    tone: "border-red-200 bg-red-50 text-red-950",
    iconTone: "bg-red-100 text-red-600",
    actionTone: "bg-red-600 hover:bg-red-700",
  };
  if (summary.pendingApprovals > 0) return {
    eyebrow: "等待你确认",
    title: `有 ${summary.pendingApprovals} 项工作需要决定`,
    description: "助手已经处理到需要人工判断的位置，确认后才会继续。",
    action: "处理待确认事项",
    href: "/runs?status=waiting_approval",
    icon: Clock3,
    tone: "border-amber-200 bg-amber-50 text-amber-950",
    iconTone: "bg-amber-100 text-amber-700",
    actionTone: "bg-amber-700 hover:bg-amber-800",
  };
  if (summary.pendingEvents > 0) return {
    eyebrow: "等待补充",
    title: `有 ${summary.pendingEvents} 项工作可以继续推进`,
    description: "补充外部消息或所需资料后，助手会从暂停处继续处理。",
    action: "查看等待中的工作",
    href: "/runs?status=waiting_event",
    icon: Activity,
    tone: "border-cyan-200 bg-cyan-50 text-cyan-950",
    iconTone: "bg-cyan-100 text-cyan-700",
    actionTone: "bg-cyan-700 hover:bg-cyan-800",
  };
  if (summary.activeAgents === 0) return {
    eyebrow: "从这里开始",
    title: "创建第一位 AI 助手",
    description: "写下一项真实工作目标，系统会生成一份可继续编辑的流程草稿。",
    action: "创建助手",
    href: "/agents/new",
    icon: Sparkles,
    tone: "border-indigo-200 bg-indigo-50 text-indigo-950",
    iconTone: "bg-indigo-100 text-indigo-700",
    actionTone: "bg-indigo-600 hover:bg-indigo-700",
  };
  return {
    eyebrow: "当前无需处理",
    title: "AI 工作团队运行稳定",
    description: "没有失败、待确认或等待补充的事项，可以继续查看结果或创建新的工作。",
    action: "查看最近运行",
    href: "/runs",
    icon: CheckCircle2,
    tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
    iconTone: "bg-emerald-100 text-emerald-700",
    actionTone: "bg-emerald-700 hover:bg-emerald-800",
  };
}

export function DashboardOverview({ summary, recentRuns, recentAgents }: {
  summary: DashboardSummary;
  recentRuns: RunSummary[];
  recentAgents: AgentSummary[];
}) {
  const nextAction = nextActionFor(summary);
  const NextIcon = nextAction.icon;
  const cards = [
    { label: "在用助手", value: summary.activeAgents, detail: `${summary.publishedAgents} 个已发布`, href: "/agents", icon: Bot, tone: "bg-indigo-50 text-indigo-600" },
    { label: "已就绪资料", value: summary.indexedSources, detail: "可供助手检索", href: "/knowledge", icon: Database, tone: "bg-cyan-50 text-cyan-600" },
    { label: "近 24 小时运行", value: summary.runsLast24h, detail: `${summary.failuresLast24h} 次失败`, href: "/runs", icon: Activity, tone: "bg-violet-50 text-violet-600" },
    { label: "正在处理", value: summary.activeRuns, detail: `${summary.pendingApprovals} 项等待确认 · ${summary.pendingEvents} 项等待继续`, href: "/runs", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600" },
  ];
  return (
    <>
      <section className={`flex flex-col gap-4 rounded-2xl border p-5 shadow-sm sm:flex-row sm:items-center ${nextAction.tone}`}>
        <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${nextAction.iconTone}`}><NextIcon aria-hidden="true" className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-65">{nextAction.eyebrow}</p>
          <h2 className="mt-1 text-lg font-bold tracking-tight">{nextAction.title}</h2>
          <p className="mt-1 text-sm leading-6 opacity-75">{nextAction.description}</p>
        </div>
        <Link href={nextAction.href} className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white shadow-sm transition ${nextAction.actionTone}`}>{nextAction.action}<ArrowRight className="size-4" /></Link>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return <Link key={card.label} href={card.href} className="group rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
            <div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl ${card.tone}`}><Icon aria-hidden="true" className="size-[18px]" /></span><span className="text-slate-300 transition group-hover:text-indigo-500">→</span></div>
            <p className="mt-4 text-xs font-medium text-slate-500">{card.label}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{card.value}</p>
            <p className="mt-1 text-xs text-slate-400">{card.detail}</p>
          </Link>
        })}
      </section>
      {summary.pendingApprovals > 0 ? (
        <Link href="/runs?status=waiting_approval" className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
          <Sparkles aria-hidden="true" className="size-4 shrink-0" />
          有 {summary.pendingApprovals} 项工作等待员工确认，点击查看并处理。
        </Link>
      ) : null}
      {summary.pendingEvents > 0 ? (
        <Link href="/runs?status=waiting_event" className="flex items-center gap-3 rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm font-medium text-cyan-800">
          <Activity aria-hidden="true" className="size-4 shrink-0" />
          有 {summary.pendingEvents} 项工作等待外部消息或员工补充，点击查看并继续。
        </Link>
      ) : null}
      <section className="content-card flex flex-col gap-4" aria-labelledby="recent-agents-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="eyebrow">我的助手</p><h2 id="recent-agents-title" className="section-title mt-1">最近修改的助手</h2><p className="mt-1 text-sm leading-6 text-slate-500">从上次修改的位置继续完善或查看运行。这里展示最近修改的六位助手。</p></div>
          <Link href="/agents" className="inline-flex h-9 items-center gap-1 text-sm font-semibold text-indigo-700 hover:text-indigo-800">查看全部助手<ArrowRight className="size-4" /></Link>
        </div>
        {recentAgents.length > 0 ? <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {recentAgents.map((agent) => <li key={agent.id} className="min-w-0">
            <Link href={`/agents/${agent.id}`} className="group flex h-full min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200 hover:bg-indigo-50/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Bot aria-hidden="true" className="size-5" /></span>
              <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-slate-900">{agent.name}</span><span className="mt-1 block text-xs text-slate-500">{agent.versionCount > 0 ? `${agent.versionCount} 个已保存版本` : "尚无已保存版本"}</span><span className="mt-2 line-clamp-2 block break-words text-xs leading-5 text-slate-500">{agent.description || "继续完善这位助手的工作目标与流程。"}</span></span>
              <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-slate-300 transition group-hover:text-indigo-600" />
            </Link>
          </li>)}
        </ul> : <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-5 py-7 text-center"><Bot aria-hidden="true" className="mx-auto size-7 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700">还没有助手</p><p className="mt-1 text-xs text-slate-500">先描述一项真实工作，再继续编排与试用。</p><Link href="/agents/new" className="mt-3 inline-flex text-sm font-semibold text-indigo-700 hover:underline">创建第一位助手</Link></div>}
      </section>
      <section className="content-card flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="section-title">最近运行</h2><p className="mt-1 text-sm text-slate-500">最近五次工作处理进展。</p></div>
          <Link href="/runs" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">查看全部 →</Link>
        </div>
        <RunList runs={recentRuns} />
      </section>
    </>
  );
}
