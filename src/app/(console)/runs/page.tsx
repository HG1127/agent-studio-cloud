import { RunListFilters } from "@/contracts/run";
import { RunFilters } from "@/features/runs/RunFilters";
import { RunList } from "@/features/runs/RunList";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { listRunAgentOptions, listRuns } from "@/server/queries/runs";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RunsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsed = RunListFilters.safeParse({
    status: one(params.status) || undefined,
    sourceType: one(params.source) || undefined,
    agentId: one(params.agent) || undefined,
  });
  const filters = parsed.success ? parsed.data : {};
  const [runs, agentOptions] = await Promise.all([
    listRuns(DEMO_WORKSPACE_ID, filters),
    listRunAgentOptions(DEMO_WORKSPACE_ID),
  ]);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">运行记录</h1>
        <p className="text-sm text-gray-500">查看每次运行的状态、执行轨迹与结果。</p>
      </header>
      <RunFilters filters={filters} agents={agentOptions} />
      <RunList runs={runs} />
    </main>
  );
}
