import { RunList } from "@/features/runs/run-list";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { listRuns } from "@/server/queries/runs";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await listRuns(DEMO_WORKSPACE_ID);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">运行记录</h1>
        <p className="text-sm text-gray-500">查看每次运行的状态、执行轨迹与结果。</p>
      </header>
      <RunList runs={runs} />
    </main>
  );
}
