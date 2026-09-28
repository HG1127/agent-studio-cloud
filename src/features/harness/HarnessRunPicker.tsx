import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";
import type { RunSummary } from "@/contracts/run";
import { RunStatusBadge } from "@/features/runs/RunList";

export function HarnessRunPicker({ runs, selectedId }: { runs: RunSummary[]; selectedId: string | null }) {
  return <section aria-labelledby="diagnostic-runs-title" className="content-card min-w-0 self-start">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 id="diagnostic-runs-title" className="section-title">最近的运行</h2><p className="mt-1 text-xs leading-5 text-slate-500">仅列出最近 {runs.length} 条；旧记录可从任务详情进入诊断。</p></div><Link href="/runs" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900">全部记录<ArrowRight className="size-3.5" /></Link></div>
    {runs.length ? <nav aria-label="选择诊断任务" className="mt-4 max-h-[44rem] space-y-2 overflow-y-auto">
      {runs.map((run) => <Link key={run.id} href={`/harness?run=${run.id}`} aria-current={run.id === selectedId ? "page" : undefined} className={`block rounded-xl border p-3 transition ${run.id === selectedId ? "border-indigo-300 bg-indigo-50/70" : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50"}`}><span className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 break-words text-sm font-semibold text-slate-900">{run.agentName}</span><RunStatusBadge status={run.status} /></span><span className="mt-1 block text-xs text-slate-500">{run.version === null ? "运行版本不可用" : `版本 ${run.version}`} · {run.startedAt ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(run.startedAt)) : "尚未开始"}</span></Link>)}
    </nav> : <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center"><Activity className="mx-auto size-6 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700">还没有运行记录</p><p className="mt-1 text-xs leading-5 text-slate-500">先运行一位已发布的助手，再到这里核对真实步骤和轨迹。</p><Link href="/agents" className="mt-3 inline-flex text-xs font-semibold text-indigo-700">选择助手</Link></div>}
  </section>;
}
