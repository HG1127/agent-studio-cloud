import Link from "next/link";
import type { ModelCallCounts, ModelUsageTotals, RunModelUsage } from "@/contracts/model-usage";
import type { ModelUsageChainRun, RunModelUsageChain } from "@/contracts/model-usage-chain";
import { RUN_STATUS_LABEL } from "./RunList";

export function modelUsageQuantity(value: number | null): string {
  return value === null ? "未知" : value.toLocaleString("zh-CN");
}

function UsageFigures({ calls, usage }: { calls: ModelCallCounts; usage: ModelUsageTotals }) {
  const figures: Array<[string, number | null]> = [
    ["已登记调用", calls.total], ["已返回调用", calls.returned],
    ["等待结算", calls.pending], ["失败调用", calls.failed],
    ["已知输入用量", usage.knownInputTokens], ["已知输出用量", usage.knownOutputTokens],
    ["完整报告的已知合计", usage.knownCallTotalTokens],
  ];
  return <>
    <dl className="mt-4 grid grid-cols-2 gap-3">
      {figures.map(([label, value]) => <div key={label} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 p-3">
        <dt className="text-xs leading-5 text-slate-500">{label}</dt>
        <dd className="mt-1 break-words text-lg font-semibold tabular-nums text-slate-900">{modelUsageQuantity(value)}</dd>
      </div>)}
    </dl>
    <p className="mt-4 text-xs leading-6 text-slate-600">完整报告 {modelUsageQuantity(usage.completeCalls)} 次；报告不完整 {modelUsageQuantity(usage.incompleteCalls)} 次；含异常报告 {modelUsageQuantity(usage.invalidUsageCalls)} 次。</p>
    <p className="text-xs leading-6 text-slate-500">输入已有报告 {modelUsageQuantity(usage.inputCalls)} 次，输出已有报告 {modelUsageQuantity(usage.outputCalls)} 次；两项可能来自不同调用，不能直接相加当作完整合计。合计只纳入完整报告，未报告的用量不按零计算。</p>
  </>;
}

function SnapshotTime({ at }: { at: string }) {
  return <p className="mt-4 text-xs leading-5 text-slate-500">统计快照时间：<time dateTime={at}>{new Date(at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）</time></p>;
}

export function SingleModelUsageSummary({ summary }: { summary: RunModelUsage }) {
  return <>
    <p className="mt-3 text-sm leading-6 text-slate-700">{summary.tracking === "legacy-or-partial"
      ? "历史或不完整登记：这里只显示已读到的调用，不能据此确认本任务的全部用量。"
      : summary.calls.total === 0 ? "本次快照尚无已登记的模型调用，不代表整条协作链没有调用。"
      : summary.usage.recordedUsageComplete ? "已登记调用的用量报告齐全，不代表任务已结束或未来不会新增调用。"
      : "已登记调用的用量报告仍不完整，已知小计不能当作全部用量。"}</p>
    <UsageFigures calls={summary.calls} usage={summary.usage} />
    <SnapshotTime at={summary.assessedAt} />
  </>;
}

function chainRunLabel(run: ModelUsageChainRun, chain: RunModelUsageChain, index: number) {
  return run.summary.runId === chain.requestedRunId ? "当前任务" : run.summary.runId === chain.anchorRunId
    ? chain.graph.rootKnown ? "起始任务" : "本次统计起点" : "关联任务 " + (index + 1);
}

const RELATION_LABEL = { root: "起始关系", explicit: "已保存关系", legacy: "历史关系", invalid: "关系无法核对" } as const;

export function ChainModelUsageSummary({ summary }: { summary: RunModelUsageChain }) {
  const graph = summary.graph;
  const warnings = [
    !graph.rootKnown ? "起始任务未确认" : null,
    graph.missingParent ? "部分上级任务缺失" : null,
    graph.cycleDetected ? "关系中存在循环" : null,
    graph.truncated ? "统计范围已截断" : null,
    graph.legacyRelationRuns ? "历史关系 " + graph.legacyRelationRuns + " 项" : null,
    graph.invalidRelationRuns ? "无法核对关系 " + graph.invalidRelationRuns + " 项" : null,
    graph.untrackedRelationRuns ? "关系登记不完整 " + graph.untrackedRelationRuns + " 项" : null,
    graph.untrackedModelRuns ? "调用登记不完整 " + graph.untrackedModelRuns + " 项" : null,
    graph.unknownStatusRuns ? "状态未知 " + graph.unknownStatusRuns + " 项" : null,
  ].filter((value): value is string => value !== null);
  return <>
    <p className="mt-3 text-sm leading-6 text-slate-700">{graph.complete ? "本次纳入的协作关系已核对。" : "这里只能核对部分协作范围，不能当作整条协作链的总用量。"}
      {summary.usage.recordedUsageComplete ? " 已纳入调用的用量报告齐全。" : " 用量报告或调用登记仍不完整。"}</p>
    <p className="mt-2 text-xs leading-6 text-slate-600">已纳入 {graph.includedRuns} 个任务；活动任务 {summary.execution.liveRuns} 个，已结束 {summary.execution.finishedRuns} 个。
      {summary.execution.isFinalSnapshot ? " 纳入任务均已结束，仍须核对调用结算与报告覆盖；这不是最终账单。" : " 这不是最终执行快照，统计可能继续变化。"}</p>
    {warnings.length ? <ul aria-label="协作统计限制" className="mt-3 list-disc space-y-1 rounded-xl border border-amber-200 bg-amber-50 py-3 pl-8 pr-3 text-xs leading-5 text-amber-950">
      {warnings.map((warning) => <li key={warning}>{warning}</li>)}
    </ul> : null}
    <p className="mt-2 text-xs leading-6 text-slate-500">一次最多纳入 {summary.limits.maxRuns} 个任务、向下 {summary.limits.maxDepth} 层；是否完整以本次范围和覆盖状态为准。</p>
    <UsageFigures calls={summary.calls} usage={summary.usage} />
    <SnapshotTime at={summary.assessedAt} />
    <details className="mt-4 rounded-xl border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">查看已纳入任务的用量（{summary.runs.length}）</summary>
      <p className="mt-3 text-xs leading-5 text-slate-500">序号只用于区分记录，不表示执行先后。点击任务可查看其真实记录；每条只统计该任务自身，不重复加入其协作子任务。</p>
      <ol className="mt-3 space-y-3">
        {summary.runs.map((run, index) => <li key={run.summary.runId} className="min-w-0 rounded-lg bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            {run.summary.runId === summary.requestedRunId ? <span className="font-semibold">当前任务</span>
              : <Link href={"/runs/" + run.summary.runId + "#model-usage"} className="font-semibold text-indigo-700 underline underline-offset-4">{chainRunLabel(run, summary, index)}</Link>}
            <span className="text-xs text-slate-600">{run.status === "unknown" ? "状态未知" : RUN_STATUS_LABEL[run.status]} · 第 {run.depth} 层</span>
          </div>
          <p className="mt-2 text-xs leading-6 text-slate-600">{RELATION_LABEL[run.relation]}；{run.relationTracking === "tracked-v1" ? "关系已登记" : "关系登记不完整"}；{run.summary.tracking === "tracked-v1" ? "调用已登记" : "调用登记不完整"}。</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs leading-5">
            <div><dt>已登记调用</dt><dd>{modelUsageQuantity(run.summary.calls.total)}</dd></div>
            <div><dt>完整报告的已知合计</dt><dd>{modelUsageQuantity(run.summary.usage.knownCallTotalTokens)}</dd></div>
            <div><dt>已知输入用量</dt><dd>{modelUsageQuantity(run.summary.usage.knownInputTokens)}</dd></div>
            <div><dt>已知输出用量</dt><dd>{modelUsageQuantity(run.summary.usage.knownOutputTokens)}</dd></div>
          </dl>
          <p className="mt-2 text-xs leading-5 text-slate-500">等待结算 {run.summary.calls.pending} 次，失败 {run.summary.calls.failed} 次；报告不完整 {run.summary.usage.incompleteCalls} 次，异常 {run.summary.usage.invalidUsageCalls} 次。</p>
        </li>)}
      </ol>
    </details>
  </>;
}
