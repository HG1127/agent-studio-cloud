import { RunListFilters } from "@/contracts/run";
import { RunFilters } from "@/features/runs/RunFilters";
import { RunList, RunPagination } from "@/features/runs/RunList";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { firstSearchParam, pageFromSearchParam } from "@/lib/search-params";
import { listRunAgentOptions, listRuns } from "@/server/queries/runs";
import { withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function RunsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsed = RunListFilters.safeParse({
    status: firstSearchParam(params.status) || undefined,
    sourceType: firstSearchParam(params.source) || undefined,
    agentId: firstSearchParam(params.agent) || undefined,
  });
  const filters = parsed.success ? parsed.data : {};
  const page = pageFromSearchParam(params.page);
  const [runs, agentOptions] = await withSafeQueryError(() => Promise.all([
    listRuns(DEMO_WORKSPACE_ID, filters, { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    listRunAgentOptions(DEMO_WORKSPACE_ID),
  ]), "runs-page");
  const hasNext = runs.length > PAGE_SIZE;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">运行记录</h1>
        <p className="text-sm text-gray-500">查看每次运行的状态、执行轨迹与结果。</p>
      </header>
      <RunFilters filters={filters} agents={agentOptions} />
      <RunList runs={runs.slice(0, PAGE_SIZE)} />
      <RunPagination page={page} hasNext={hasNext} filters={filters} />
    </main>
  );
}
