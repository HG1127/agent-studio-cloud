import { DashboardOverview } from "@/features/dashboard/DashboardOverview";
import { HealthCard } from "@/features/dashboard/HealthCard";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getDashboardSummary } from "@/server/queries/dashboard";
import { listRuns } from "@/server/queries/runs";
import { withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [summary, recentRuns] = await withSafeQueryError(() => Promise.all([
    getDashboardSummary(),
    listRuns(DEMO_WORKSPACE_ID, {}, { limit: 5 }),
  ]), "dashboard");
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 p-8">
      <header>
        <h1 className="text-2xl font-bold">工作台总览</h1>
        <p className="mt-1 text-sm text-gray-500">查看助手、资料和最近运行的整体状态。</p>
      </header>
      <DashboardOverview summary={summary} recentRuns={recentRuns} />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">系统状态</h2>
        <HealthCard />
      </section>
    </main>
  );
}
