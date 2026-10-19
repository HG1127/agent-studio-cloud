import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import type { RunStatus, RunStepView, RunView } from "@/contracts/run";
import { AgentTargetOption } from "@/contracts/agent";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { RunStatusBadge } from "@/features/runs/RunList";
import { SavedRunResultValue } from "@/features/runs/SavedRunResultValue";
import { presentBusinessOutput } from "@/features/runs/present-business-output";
import { savedRunResultView, readSavedResultPath } from "@/features/runs/run-result-view";
import { WebToolResultView } from "./WebToolResultView";
import { WebToolSavedInputCoverage } from "./WebToolSavedInputCoverage";
import { WebToolRunUpdates } from "./WebToolRunUpdates";
import { webToolHref, webToolRunHref } from "./web-tool-navigation";

const GUIDANCE: Record<RunStatus, string> = {
  queued: "任务已创建，正在等待执行；当前没有确认最终交付。",
  running: "任务正在执行。可打开任务详情查看实时进度，或稍后重新读取此页。",
  waiting_approval: "任务正在等待人工确认。请在任务详情核对待确认内容，不要重复创建任务。",
  waiting_event: "任务正在等待补充消息。请在任务详情核对并提交所需内容。",
  completed: "完成状态已记录；请核对下面的实际内容，完成不等于通过业务验收。",
  failed: "任务未完成。请在任务详情核对失败原因和执行证据，再决定是否重试。",
  cancelled: "任务已取消。保留的内容不代表本次已完成交付。",
};

export function WebToolSavedRun({ run, selectedVersionId, selectedVersion, sourceStatus, steps = [], stepsUnavailable = false }: {
  run: RunView; selectedVersionId: string; selectedVersion: number; sourceStatus: string; steps?: readonly RunStepView[]; stepsUnavailable?: boolean;
}) {
  const result = savedRunResultView(run);
  const selectedId = AgentTargetOption.shape.versionId.safeParse(selectedVersionId);
  const actualId = AgentTargetOption.shape.versionId.safeParse(run.versionId);
  const sameVersion = selectedId.success && actualId.success && selectedId.data.toLowerCase() === actualId.data.toLowerCase();
  const valuePreviews = result.outputs.map(({ key, output }) => <SavedRunResultValue key={key} run={{ id: run.id, outputContract: run.outputContract }} fieldKey={key} value={typeof output === "string" ? presentBusinessOutput(output).text : output} steps={stepsUnavailable ? [] : steps} />);
  const textAdjusted = result.outputs.some(({ output }) => typeof output === "string" && presentBusinessOutput(output).text !== output);
  const textUnavailable = result.outputs.some(({ output }) => typeof output === "string" && !presentBusinessOutput(output).reviewable);
  const record = result.redactedResult !== null && typeof result.redactedResult === "object" && !Array.isArray(result.redactedResult) ? result.redactedResult as Record<string, unknown> : {};
  const missing = run.outputContract.fields.filter((field) => field.required && readSavedResultPath(record, field.path) === undefined).length;

  return <section id="web-tool-run-result" aria-labelledby="web-tool-run-result-title" className="content-card scroll-mt-32 min-w-0 space-y-5 border-indigo-200">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><FileCheck2 aria-hidden className="mt-1 size-5 shrink-0 text-indigo-600" /><div className="min-w-0"><p className="eyebrow">关联的内部手动运行</p><h2 id="web-tool-run-result-title" className="mt-1 break-words text-lg font-bold text-slate-950">内部运行结果</h2><p className="mt-2 break-words text-sm font-medium text-slate-700">{run.agentName} · {run.version === null ? "实际版本暂不可读" : `实际版本 ${run.version}`}</p></div></div><div className="flex flex-wrap items-center gap-2"><RunStatusBadge status={run.status} /><PageRefreshButton /><Link href={webToolHref({ versionId: selectedVersionId })} prefetch={false} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">移除本次关联</Link></div></div>
    <p className="text-sm leading-6 text-slate-600">这里只回看已保存的内部任务，不是网页工具的外部调用记录。网址中的关联不能证明任务从本页创建；重新读取只查询状态，不会提交输入或启动任务。</p>
    {!sameVersion ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">本页核对的是版本 {selectedVersion}，本次实际{run.version === null ? "版本暂不可读" : `运行的是版本 ${run.version}`}。结果按本次运行保存的契约展示，不套用当前版本字段；不能据此证明试填版本已通过验证。</p> : null}
    {sourceStatus === "retired" ? <p className="rounded-xl bg-slate-100 p-3 text-sm leading-6 text-slate-700">核对来源是已保存的历史版本，不是当前正式版本。{run.agentArchived ? "助手已停用，只保留历史输入与结果，不能发起新任务。" : "历史运行仍可回看；下方只有在来源和助手资格核对后才可手动创建新的内部试运行，不会改用新版或恢复正式状态。"}</p> : sourceStatus !== "production" ? <p className="rounded-xl bg-slate-100 p-3 text-sm leading-6 text-slate-700">核对版本当前不具备已确认的试运行资格。这里只保留已保存的历史运行内容，不能据此启动新任务，也不把未知状态当作可运行的历史版本。</p> : null}
    {stepsUnavailable ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">步骤记录暂时无法读取，交付来源的核对状态未知。仍保留已保存的最终内容；可重新读取，或到任务详情核对执行证据。</p> : null}
    {run.agentArchived ? <p className="rounded-xl bg-slate-100 p-3 text-sm leading-6 text-slate-700">这位助手已停用。保留历史输入与结果，不能在此发起新的试运行。</p> : null}
    <WebToolRunUpdates key={run.id} run={{ id: run.id, status: run.status }} />
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-indigo-50/60 p-4"><p role="status" className="max-w-2xl text-sm leading-6 text-slate-700">{GUIDANCE[run.status]}</p><Link href={webToolRunHref(selectedVersionId, run.id)} prefetch={false} className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">{run.status === "waiting_approval" || run.status === "waiting_event" ? "打开任务处理待办" : "查看本次任务与执行证据"}</Link></div>
    {result.unavailable ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">{result.message}</p> : result.hasResult ? <div className="min-w-0 space-y-3"><h3 className="text-sm font-bold text-slate-900">{run.status === "completed" ? "已保存的交付结果" : "已保存内容（尚未确认最终交付）"}</h3>{missing ? <p role="alert" className="text-sm leading-6 text-amber-900">有 {missing} 项需要交付的字段未在结果中找到；不补造缺失内容，请到任务详情核对。</p> : null}{textAdjusted ? <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs leading-5 text-slate-700">{textUnavailable ? "正文暂时无法核对；复制保留已保存的数据，请核对后使用。" : "展示的是整理后的正文；复制保留已保存的数据，请核对后使用。"}</p> : null}<WebToolResultView key={`${run.id}:${run.status}`} result={result} valuePreviews={valuePreviews} /></div> : <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5"><h3 className="text-sm font-semibold text-slate-900">{run.status === "completed" ? "完成状态已记录，但尚无最终结果" : "尚无已保存的最终结果"}</h3><p className="mt-2 text-sm leading-6 text-slate-600">没有生成示例或模拟交付。请重新读取，或打开本次任务核对状态与执行证据。</p></div>}
    <details className="min-w-0 rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">核对本次保存的输入</summary><div className="mt-4"><WebToolSavedInputCoverage run={run} /></div></details>
  </section>;
}
