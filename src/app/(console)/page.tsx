import Link from "next/link";
import { DashboardOverview } from "@/features/dashboard/DashboardOverview";
import { HealthCard } from "@/features/dashboard/HealthCard";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getDashboardSummary } from "@/server/queries/dashboard";
import { listAgents } from "@/server/queries/agents";
import { listRuns } from "@/server/queries/runs";
import { withSafeQueryError } from "@/server/security/query-error";
import { PageHeader } from "@/components/ui/page-header";
import { Activity, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [summary, recentRuns, recentAgents] = await withSafeQueryError(() => Promise.all([
    getDashboardSummary(),
    listRuns(DEMO_WORKSPACE_ID, {}, { limit: 5 }),
    listAgents(DEMO_WORKSPACE_ID, { limit: 6 }),
  ]), "dashboard");
  return (
    <main className="page-shell">
      <PageHeader eyebrow="今日工作" title="工作台" description="先处理真正需要人的事项，再查看助手与最近运行的整体状态。" action={<>
        <Link href="/runs" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50"><Activity className="size-4" />查看运行</Link>
        <Link href="/agents/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"><Plus className="size-4" />新建助手</Link>
      </>} />
      <DashboardOverview summary={summary} recentRuns={recentRuns} recentAgents={recentAgents} />
      <section id="system-health" className="content-card scroll-mt-20 flex flex-col gap-4">
        <div><h2 className="section-title">系统服务</h2><p className="mt-1 text-sm text-slate-500">创建、运行与保存工作所需服务的实时状态。</p></div>
        <HealthCard />
      </section>
    </main>
  );
}
