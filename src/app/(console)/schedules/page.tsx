import Link from "next/link";
import { AlertCircle, History } from "lucide-react";
import { CreateScheduleForm } from "@/features/schedules/CreateScheduleForm";
import { ScheduleList } from "@/features/schedules/ScheduleList";
import { listScheduleableAgents, listSchedules } from "@/server/queries/schedules";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const [schedules, agents] = await Promise.all([listSchedules(), listScheduleableAgents()]);
  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="自动运行"
        title="定时任务"
        description="让已发布的助手按北京时间自动运行；每次执行都会保留输入、过程和结果。"
        action={<><Link href="/runs?source=schedule" className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"><History className="size-4" />自动运行记录</Link><CreateScheduleForm agents={agents} /></>}
      />
      {agents.length === 0 ? <section className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-700" /><div><h2 className="text-sm font-semibold text-amber-950">先发布一个正式版本</h2><p className="mt-1 text-sm leading-6 text-amber-800">只有已有正式版本的助手才能创建定时任务，避免草稿变化影响自动运行。</p></div></div><Link href="/agents" className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-amber-800 px-4 text-sm font-semibold text-white hover:bg-amber-900">查看助手</Link></section> : null}
      <section className="content-card">
        <div className="mb-5 flex flex-col gap-2 border-b border-slate-100 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="section-title">任务总览</h2><p className="mt-1 text-sm leading-6 text-slate-500">优先处理失败任务；暂停和归档不会删除已经生成的运行记录。</p></div><p className="text-xs text-slate-400">时间口径：北京时间（UTC+8）</p></div>
        <ScheduleList initial={schedules} />
      </section>
    </main>
  );
}
