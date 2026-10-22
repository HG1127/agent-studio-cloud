import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { HarnessRunPicker } from "@/features/harness/HarnessRunPicker";
import { RunDiagnostics } from "@/features/harness/RunDiagnostics";
import { RunContextSection } from "@/features/harness/RunContextSection";
import { RunEvidenceOverview } from "@/features/harness/RunEvidenceOverview";
import { ExecutionResourcesPanel } from "@/features/harness/ExecutionResourcesPanel";
import { WorkspacePolicyPanel } from "@/features/harness/WorkspacePolicyPanel";
import { HarnessWorkspace } from "@/features/harness/HarnessWorkspace";
import { HarnessPolicyReadResult } from "@/contracts/harness-management";
import { ExecutionPolicyHistoryResult, ExecutionPolicyReadResult, ExecutionPolicySnapshot } from "@/contracts/execution-resources";
import { harnessConsoleHref, harnessNavigation } from "@/features/harness/harness-navigation";
import { RunReportFile, RunView } from "@/contracts/run";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

export default async function HarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const parsedNavigation = harnessNavigation(params);
  const contextFilters = parsedNavigation.context;
  const hasRequested = params.run !== undefined;
  const requestedId = parsedNavigation.state.runId ?? null;
  // 仅在本次页面读取中共用模块加载，不缓存业务查询结果。
  let runsQueries: Promise<typeof import("@/server/queries/runs")> | undefined;
  let traceQueries: Promise<typeof import("@/server/queries/trace")> | undefined;
  let executionResourceQueries: Promise<typeof import("@/server/queries/execution-resources")> | undefined;
  const loadRunsQueries = () => runsQueries ??= import("@/server/queries/runs");
  const loadTraceQueries = () => traceQueries ??= import("@/server/queries/trace");
  const loadExecutionResourceQueries = () => executionResourceQueries ??= import("@/server/queries/execution-resources");

  const [runsResult, requestedRunResult, resourceReadResult, resourceHistoryResult, safetyPolicyResult] = await Promise.allSettled([
    withSafeQueryError(async () => {
      const { listRuns } = await loadRunsQueries();
      return listRuns(DEMO_WORKSPACE_ID, {}, { limit: 30 });
    }, "harness-runs"),
    requestedId ? withSafeQueryError(async () => {
      const { getRunView } = await loadRunsQueries();
      return getRunView(requestedId, DEMO_WORKSPACE_ID);
    }, "harness-run") : Promise.resolve(null),
    withSafeQueryError(async () => {
      const { getExecutionResourcePolicy } = await loadExecutionResourceQueries();
      return ExecutionPolicySnapshot.parse(await getExecutionResourcePolicy(DEMO_WORKSPACE_ID));
    }, "harness-resources"),
    withSafeQueryError(async () => {
      const { listExecutionPolicyHistory } = await loadExecutionResourceQueries();
      return ExecutionPolicyHistoryResult.parse(await listExecutionPolicyHistory(DEMO_WORKSPACE_ID, { limit: 20 }));
    }, "harness-resource-history"),
    withSafeQueryError(async () => {
      const { getHarnessPolicyQuery } = await import("@/server/queries/harness-policies");
      return HarnessPolicyReadResult.parse(await getHarnessPolicyQuery());
    }, "harness-safety-policy"),
  ]);
  const safetyPolicy = safetyPolicyResult.status === "fulfilled" ? safetyPolicyResult.value
    : HarnessPolicyReadResult.parse({ ok: false, error: "安全规则暂时无法读取，当前配置未知。" });
  const resourceRead = ExecutionPolicyReadResult.parse(resourceReadResult.status === "fulfilled"
    ? { ok: true, snapshot: resourceReadResult.value } : { ok: false, error: "资源摘要暂时无法读取，当前上限与可用名额未知。" });
  const resourceHistory = resourceHistoryResult.status === "fulfilled" ? resourceHistoryResult.value
    : ExecutionPolicyHistoryResult.parse({ ok: false, error: "资源设置历史暂时无法读取，不能判断本页是否有记录。" });
  const recentRuns = runsResult.status === "fulfilled" ? runsResult.value : null;
  const selectedId = hasRequested ? requestedId : recentRuns?.find((run) => ["failed", "waiting_approval", "waiting_event"].includes(run.status))?.id ?? recentRuns?.[0]?.id ?? null;
  const runResult = !hasRequested && selectedId
    ? (await Promise.allSettled([withSafeQueryError(async () => {
      const { getRunView } = await loadRunsQueries();
      return getRunView(selectedId, DEMO_WORKSPACE_ID);
    }, "harness-run")]))[0]
    : requestedRunResult;
  const candidateRun = runResult.status === "fulfilled" ? runResult.value : null;
  const candidateId = RunView.shape.id.safeParse(candidateRun?.id);
  const wrongOwner = candidateRun !== null && (!candidateId.success || candidateId.data.toLowerCase() !== selectedId?.toLowerCase());
  const run = wrongOwner ? null : candidateRun;
  const runReadFailed = runResult.status === "rejected" || wrongOwner;
  const historyRequested = !parsedNavigation.invalidTrace && parsedNavigation.state.trace.range === "history";
  const historyAllowed = historyRequested && !parsedNavigation.invalidRun && typeof params.run === "string"
    && requestedId !== null && run !== null && run.id.toLowerCase() === requestedId.toLowerCase();
  const [stepsResult, traceResult, contextResult, historyTraceResult] = run ? await Promise.allSettled([
    withSafeQueryError(async () => {
      const { listRunSteps } = await loadRunsQueries();
      return listRunSteps(run.id, DEMO_WORKSPACE_ID);
    }, "harness-steps"),
    withSafeQueryError(async () => {
      const { listRecentTrace } = await loadTraceQueries();
      return listRecentTrace(run.id, DEMO_WORKSPACE_ID);
    }, "harness-trace"),
    contextFilters.success ? withSafeQueryError(async () => {
      const { getRunContext } = await loadRunsQueries();
      return RunReportFile.shape.context.parse(await getRunContext(run.id, DEMO_WORKSPACE_ID));
    }, "harness-context") : Promise.resolve(null),
    historyAllowed ? withSafeQueryError(async () => {
      const { listTrace } = await loadTraceQueries();
      return listTrace(run.id, DEMO_WORKSPACE_ID);
    }, "harness-trace-history") : Promise.resolve(null),
  ]) : [null, null, null, null];
  const steps = stepsResult?.status === "fulfilled" ? stepsResult.value : null;
  const trace = traceResult?.status === "fulfilled" ? traceResult.value : null;
  const context = contextResult?.status === "fulfilled" ? contextResult.value : null;
  const historyTrace = historyRequested ? historyTraceResult?.status === "fulfilled" ? historyTraceResult.value : null : undefined;
  const navigation = { ...parsedNavigation.state, runId: run?.id ?? selectedId ?? undefined };
  const multipleInvalidFilters = [parsedNavigation.invalidList, parsedNavigation.invalidTrace, !contextFilters.success].filter(Boolean).length > 1;

  return <main className="page-shell">
    <PageHeader eyebrow="运行管理" title="运行控制台" description="定位需处理的任务，检查运行证据，设计默认规则与安全边界。" action={<PageRefreshButton />} />
    <HarnessWorkspace
      runs={recentRuns}
      policy={safetyPolicy}
      navigation={navigation}
      rules={<WorkspacePolicyPanel initialRead={safetyPolicy} />}
      resources={<ExecutionResourcesPanel initialRead={resourceRead} initialHistory={resourceHistory} />}
      diagnostics={<div className="space-y-4">
    {multipleInvalidFilters ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p role="alert" className="text-sm leading-6 text-amber-950">有多个分区的筛选条件无效。下方的筛选与导航入口只保留通过校验的分区范围，所有无效分区会一并清除；请先核对后继续。</p><Link href={harnessConsoleHref(navigation)} prefetch={false} className="mt-2 inline-block text-sm font-semibold text-indigo-700">清除所有无效筛选</Link></div> : null}
    {run ? <RunEvidenceOverview steps={steps} trace={trace} context={context} contextReadFailed={contextResult?.status === "rejected"} contextFiltersValid={contextFilters.success} /> : null}
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.7fr)]">
      <HarnessRunPicker key={`${JSON.stringify(navigation.list)}:${parsedNavigation.invalidList}`} runs={recentRuns} selectedId={run?.id ?? selectedId} navigation={navigation} invalidFilters={parsedNavigation.invalidList} />
      {run ? <RunDiagnostics run={run} steps={steps} trace={trace} historyTrace={historyTrace} navigation={navigation} invalidTraceFilters={parsedNavigation.invalidTrace} contextSection={<RunContextSection runId={run.id} context={context} steps={steps} readFailed={contextResult?.status === "rejected"} filters={contextFilters} navigation={navigation} />} /> : <section className="content-card flex min-h-72 flex-col items-center justify-center text-center"><CircleAlert className="size-7 text-slate-400" /><h2 className="mt-3 text-base font-semibold text-slate-900">{runReadFailed ? "诊断详情暂时无法读取" : hasRequested ? "找不到这次运行" : "选择一次运行查看诊断"}</h2><p role={runReadFailed ? "alert" : undefined} className="mt-2 max-w-md text-sm leading-6 text-slate-500">{runReadFailed ? "未能读取所选任务，不能判断它已失效。可重新读取状态，或选择其他可见任务；读取不会改变执行或提交决定。" : hasRequested ? "这条链接可能已失效，或当前工作区无权查看。请从左侧选择可见任务。" : recentRuns === null ? "最近记录暂不可读，当前没有自动选择任务。可重新读取状态，或从运行记录进入指定任务的诊断。" : "有运行记录后，可核对真实执行步骤和需关注的轨迹。"}</p><Link href="/runs" className="mt-4 text-sm font-semibold text-indigo-700">前往运行记录</Link></section>}
    </div>
      </div>} />
  </main>;
}
