import Link from "next/link";
import { CircleAlert, Settings2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { HarnessRunPicker } from "@/features/harness/HarnessRunPicker";
import { RunDiagnostics } from "@/features/harness/RunDiagnostics";
import { RunContextSection } from "@/features/harness/RunContextSection";
import { RunEvidenceOverview } from "@/features/harness/RunEvidenceOverview";
import { ExecutionResourcesPanel } from "@/features/harness/ExecutionResourcesPanel";
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
  const [runsResult, requestedRunResult, resourceReadResult, resourceHistoryResult] = await Promise.allSettled([
    withSafeQueryError(async () => {
      const { listRuns } = await import("@/server/queries/runs");
      return listRuns(DEMO_WORKSPACE_ID, {}, { limit: 30 });
    }, "harness-runs"),
    requestedId ? withSafeQueryError(async () => {
      const { getRunView } = await import("@/server/queries/runs");
      return getRunView(requestedId, DEMO_WORKSPACE_ID);
    }, "harness-run") : Promise.resolve(null),
    withSafeQueryError(async () => {
      const { getExecutionResourcePolicy } = await import("@/server/queries/execution-resources");
      return ExecutionPolicySnapshot.parse(await getExecutionResourcePolicy(DEMO_WORKSPACE_ID));
    }, "harness-resources"),
    withSafeQueryError(async () => {
      const { listExecutionPolicyHistory } = await import("@/server/queries/execution-resources");
      return ExecutionPolicyHistoryResult.parse(await listExecutionPolicyHistory(DEMO_WORKSPACE_ID, { limit: 20 }));
    }, "harness-resource-history"),
  ]);
  const resourceRead = ExecutionPolicyReadResult.parse(resourceReadResult.status === "fulfilled"
    ? { ok: true, snapshot: resourceReadResult.value } : { ok: false, error: "资源摘要暂时无法读取，当前上限与可用名额未知。" });
  const resourceHistory = resourceHistoryResult.status === "fulfilled" ? resourceHistoryResult.value
    : ExecutionPolicyHistoryResult.parse({ ok: false, error: "资源设置历史暂时无法读取，不能判断本页是否有记录。" });
  const recentRuns = runsResult.status === "fulfilled" ? runsResult.value : null;
  const selectedId = hasRequested ? requestedId : recentRuns?.find((run) => ["failed", "waiting_approval", "waiting_event"].includes(run.status))?.id ?? recentRuns?.[0]?.id ?? null;
  const runResult = !hasRequested && selectedId
    ? (await Promise.allSettled([withSafeQueryError(async () => {
      const { getRunView } = await import("@/server/queries/runs");
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
      const { listRunSteps } = await import("@/server/queries/runs");
      return listRunSteps(run.id, DEMO_WORKSPACE_ID);
    }, "harness-steps"),
    withSafeQueryError(async () => {
      const { listRecentTrace } = await import("@/server/queries/trace");
      return listRecentTrace(run.id, DEMO_WORKSPACE_ID);
    }, "harness-trace"),
    contextFilters.success ? withSafeQueryError(async () => {
      const { getRunContext } = await import("@/server/queries/runs");
      return RunReportFile.shape.context.parse(await getRunContext(run.id, DEMO_WORKSPACE_ID));
    }, "harness-context") : Promise.resolve(null),
    historyAllowed ? withSafeQueryError(async () => {
      const { listTrace } = await import("@/server/queries/trace");
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
    <PageHeader eyebrow="专业运行管理" title="运行控制台" description="从已保存的任务、步骤和轨迹排查问题；人工确认、补充资料与重试仍在任务详情处理。" action={<PageRefreshButton />} />
    <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-950">这里可查看已保存的运行策略、上下文检查事件，并核对资源限额和变更记录。完整的默认规则管理、规则判决、上下文预算与策略模拟尚未接入；轨迹事件不能代替完整判决。</div>
    {multipleInvalidFilters ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p role="alert" className="text-sm leading-6 text-amber-950">有多个分区的筛选条件无效。下方的筛选与导航入口只保留通过校验的分区范围，所有无效分区会一并清除；请先核对后继续。</p><Link href={harnessConsoleHref(navigation)} prefetch={false} className="mt-2 inline-block text-sm font-semibold text-indigo-700">清除所有无效筛选</Link></div> : null}
    {run ? <RunEvidenceOverview steps={steps} trace={trace} context={context} contextReadFailed={contextResult?.status === "rejected"} contextFiltersValid={contextFilters.success} /> : null}
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.7fr)]">
      <HarnessRunPicker key={`${JSON.stringify(navigation.list)}:${parsedNavigation.invalidList}`} runs={recentRuns} selectedId={run?.id ?? selectedId} navigation={navigation} invalidFilters={parsedNavigation.invalidList} />
      {run ? <RunDiagnostics run={run} steps={steps} trace={trace} historyTrace={historyTrace} navigation={navigation} invalidTraceFilters={parsedNavigation.invalidTrace} contextSection={<RunContextSection runId={run.id} context={context} steps={steps} readFailed={contextResult?.status === "rejected"} filters={contextFilters} navigation={navigation} />} /> : <section className="content-card flex min-h-72 flex-col items-center justify-center text-center"><CircleAlert className="size-7 text-slate-400" /><h2 className="mt-3 text-base font-semibold text-slate-900">{runReadFailed ? "诊断详情暂时无法读取" : hasRequested ? "找不到这次运行" : "选择一次运行查看诊断"}</h2><p role={runReadFailed ? "alert" : undefined} className="mt-2 max-w-md text-sm leading-6 text-slate-500">{runReadFailed ? "未能读取所选任务，不能判断它已失效。可重新读取状态，或选择其他可见任务；读取不会改变执行或提交决定。" : hasRequested ? "这条链接可能已失效，或当前工作区无权查看。请从左侧选择可见任务。" : recentRuns === null ? "最近记录暂不可读，当前没有自动选择任务。可重新读取状态，或从运行记录进入指定任务的诊断。" : "有运行记录后，可核对真实执行步骤和需关注的轨迹。"}</p><Link href="/runs" className="mt-4 text-sm font-semibold text-indigo-700">前往运行记录</Link></section>}
    </div>
    <ExecutionResourcesPanel initialRead={resourceRead} initialHistory={resourceHistory} />
    <section aria-labelledby="harness-gaps-title" className="content-card"><h2 id="harness-gaps-title" className="section-title">尚未接入的运行控制</h2><p className="mt-1 text-sm leading-6 text-slate-500">以下完整配置、判决明细与模拟能力尚无对应的读取或管理接口，因此这里不提供不能真正生效的开关。</p><div className="mt-4 grid gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><Settings2 className="size-5 text-indigo-600" /><h3 className="mt-3 text-sm font-semibold text-slate-900">默认运行规则</h3><p className="mt-1 text-xs leading-5 text-slate-600">失败恢复、结果复核、记忆与上下文容量需要服务端返回已生效的配置。</p></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><ShieldCheck className="size-5 text-indigo-600" /><h3 className="mt-3 text-sm font-semibold text-slate-900">安全规则</h3><p className="mt-1 text-xs leading-5 text-slate-600">规则列表、优先级、启停和完整命中判决尚不能从云端核对；已保存的检查事件可在执行轨迹中查看。</p></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><CircleAlert className="size-5 text-indigo-600" /><h3 className="mt-3 text-sm font-semibold text-slate-900">策略模拟</h3><p className="mt-1 text-xs leading-5 text-slate-600">身份或环境变化后的判断必须由服务端只读计算，不能在浏览器中猜测。</p></div>
    </div></section>
  </main>;
}
