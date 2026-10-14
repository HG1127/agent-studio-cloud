"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type { EvaluationCaseResultView } from "@/contracts/evaluation";
import type { RunReportFile } from "@/contracts/run";
import { Button } from "@/components/ui/button";
import { ReadOnlyDialog } from "@/components/ui/ReadOnlyDialog";
import { CopyResultButton } from "@/features/runs/CopyResultButton";
import { RunStatusBadge } from "@/features/runs/RunList";
import { StructuredRunValue } from "@/features/runs/StructuredRunValue";
import { savedRunResultView } from "@/features/runs/run-result-view";
import { redactSensitiveData } from "@/server/domain/security/redact-sensitive";
import { checkedEvaluationReport } from "./evaluation-review-view";
import { evaluationRunDetailHref, type EvaluationReviewNavigation } from "./evaluation-review-navigation";
import { acceptanceRunDetailHref, type AcceptanceOverviewScope } from "@/features/quality/acceptance-evidence-navigation";
import { ExecutionEvidenceSteps } from "@/features/workflow-canvas/NodeExecutionEvidence";
import { requestEvidenceStepFocus } from "@/features/workflow-canvas/execution-evidence";

type ReportState = { status: "loading" } | { status: "ready"; report: RunReportFile } | { status: "error"; message: string };

function EvaluationRunEvidenceSession({ agentId, version, result, navigation, onClose, returnFocusRef, overviewScope }: {
  agentId: string; version: number; result: EvaluationCaseResultView; navigation: EvaluationReviewNavigation;
  onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null>; overviewScope?: AcceptanceOverviewScope;
}) {
  const [state, setState] = useState<ReportState>(result.runId ? { status: "loading" } : { status: "error", message: "此判定没有关联运行记录，不能读取或补造执行证据。" });
  const [slow, setSlow] = useState(false);
  const [closed, setClosed] = useState(false);
  const [retainedReport, setRetainedReport] = useState<RunReportFile | null>(null);
  const [locateError, setLocateError] = useState<string | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const locatable = useRef<RunReportFile | null>(null);
  const frames = useRef<number[]>([]);
  const closeRef = useRef(onClose);
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    const pendingFrames = frames.current;
    active.current = true; generation.current += 1;
    return () => { active.current = false; generation.current += 1; locatable.current = null; request.current?.abort(); pendingFrames.forEach((frame) => window.cancelAnimationFrame(frame)); };
  }, []);
  const read = useCallback(() => {
    if (!active.current || !result.runId) return;
    const owner = generation.current;
    locatable.current = null;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = () => active.current && generation.current === owner && request.current === controller && !controller.signal.aborted;
    const notice = window.setTimeout(() => { if (current()) setSlow(true); }, 10_000);
    const timeout = window.setTimeout(() => {
      if (!current()) return;
      controller.abort();
      setState({ status: "error", message: "报告读取超时；没有启动、重试或取消任务，可以重新读取。" });
    }, 30_000);
    void fetch(`/api/runs/${result.runId}/export`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) {
        if (current()) setState({ status: "error", message: response.status === 404 ? "关联运行暂未读到；不能据此判断证据已删除。可以重新读取，或回到验收记录核对。" : "运行报告暂时无法读取，已有验收判定仍保留。可以重新读取。" });
        return;
      }
      const report = checkedEvaluationReport(await response.json(), { agentId, version, runId: result.runId! });
      if (!current()) return;
      if (report) { setRetainedReport(report); locatable.current = report; }
      setState(report ? { status: "ready", report } : { status: "error", message: "报告格式或关联关系无法确认，未展示其中的输入与结果。请重新读取并核对助手、验收版本和运行来源。" });
    }).catch(() => {
      if (current()) setState({ status: "error", message: "网络或报告内容暂时无法确认，可以重新读取；这不会发起新的验收。" });
    }).finally(() => {
      window.clearTimeout(notice);
      window.clearTimeout(timeout);
    });
  }, [agentId, version, result.runId]);

  useEffect(() => {
    read();
    return () => { request.current?.abort(); };
  }, [read]);

  function reload() {
    if (!active.current || !result.runId) return;
    setLocateError(null);
    setState({ status: "loading" });
    setSlow(false);
    read();
  }

  function locateStep(nodeId: string) {
    const checked = locatable.current;
    if (!active.current || overviewScope || !checked || !checked.steps.some((step) => step.nodeId === nodeId)) return;
    const owner = generation.current;
    setLocateError(null); setClosed(true);
    // 先结束弹窗焦点归还，再请求当前画布；路由清定位在消费确认之后发生。
    frames.current.push(window.requestAnimationFrame(() => {
      frames.current.push(window.requestAnimationFrame(() => {
        if (!active.current || generation.current !== owner || locatable.current !== checked) return;
        if (requestEvidenceStepFocus({ agentId, nodeId })) closeRef.current();
        else { setClosed(false); setLocateError("当前画布尚未就绪，或此历史步骤不对应当前唯一顶层步骤；未定位或改动草稿，报告仍保留。"); }
      }));
    }));
  }

  const report = state.status === "ready" ? state.report : state.status === "error" ? retainedReport : null;
  const run = report?.run;
  const saved = run ? savedRunResultView(run, new Map(report!.steps.map((step) => [step.nodeId, step.nodeTitle]))) : null;
  const input = run ? redactSensitiveData(run.input) as Record<string, unknown> : {};
  return <ReadOnlyDialog open={!closed} onOpenChange={(open) => {
    if (!open) { request.current?.abort(); locatable.current = null; setClosed(true); onClose(); }
  }} returnFocusRef={returnFocusRef} title={`核对运行证据 · ${result.caseName}`} description={`验收版本 ${version}；这里仅按需读取关联运行，不会重新执行样例。`}>
    <div className="space-y-5">
      <section aria-label="已保存的样例判定" className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-900">样例判定：{result.status === "failed" ? "未通过" : result.status === "passed" ? "通过" : "运行中"}</p>{result.error ? <p className="mt-2 break-words text-sm leading-6 text-red-700">{result.error}</p> : <p className="mt-2 text-xs text-slate-600">此记录没有保存判定说明。</p>}<p className="mt-3 text-xs leading-5 text-slate-500">样例名称来自当前清单。历史检查条件快照尚未提供；此处不把当前编辑的输入或规则当成历史证据。</p></section>
      {state.status === "loading" ? <div role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800"><p className="flex items-center gap-2"><LoaderCircle aria-hidden className="size-4 animate-spin" />正在读取实际运行报告…</p>{slow ? <p className="mt-2 text-xs leading-5">读取时间较长，可继续等待或关闭窗口。关闭只停止本页读取，不会取消任务。</p> : null}</div> : state.status === "error" ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><p>{state.message}</p>{result.runId ? <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={reload}><RefreshCw aria-hidden className="size-3.5" />重新读取运行报告</Button> : null}</div> : null}
      {report && run && saved ? <>
        <section aria-label="关联任务的实际状态" className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-4"><div><p className="text-sm font-semibold text-slate-900">任务执行状态：<RunStatusBadge status={run.status} /></p><p className="mt-2 text-xs leading-5 text-slate-500">实际版本 {run.version} · 自动验收发起。执行完成不代表样例检查通过；这是本次读取的保存状态，不会自动刷新。</p>{result.status === "failed" && run.status === "completed" ? <p className="mt-2 text-sm font-medium text-amber-800">任务执行完成，但样例检查未通过。</p> : null}{result.status !== "running" && ["queued", "running", "waiting_approval", "waiting_event"].includes(run.status) ? <p role="alert" className="mt-2 text-sm text-amber-800">样例已有判定，但任务仍未结束；两处记录需要继续核对。</p> : null}{run.error ? <p className="mt-2 break-words text-sm text-red-700">{run.error}</p> : null}</div>{state.status === "ready" ? <Button type="button" variant="secondary" size="sm" onClick={reload}><RefreshCw aria-hidden className="size-3.5" />重新读取运行报告</Button> : null}</section>
        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <section aria-label="本次运行保存的输入" className="min-w-0 rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-semibold text-slate-900">本次实际输入</h3><p className="mt-1 text-xs text-slate-500">取自这次运行，不取当前样例表单。</p>{Object.keys(input).length ? <dl className="mt-3 space-y-3">{Object.entries(input).map(([key, value], index) => <div key={key} className="min-w-0 rounded-lg bg-slate-50 p-3"><dt className="mb-2 break-words text-xs font-semibold text-slate-600">{run.inputContract.fields.find((field) => field.name === key)?.label || (/\p{Script=Han}/u.test(key) ? key : `业务输入 ${index + 1}`)}</dt><dd className="min-w-0"><StructuredRunValue value={value} maxEntries={10} /></dd></div>)}</dl> : <p className="mt-3 text-sm text-slate-500">这次运行没有保存输入字段。</p>}</section>
          <section aria-label="本次运行保存的结果" className="min-w-0 rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900">本次实际结果</h3>{saved.hasResult ? <CopyResultButton result={saved.redactedResult} text={saved.copyText} label="复制本次结果" /> : null}</div>{saved.hasResult ? saved.outputs.length ? <dl className="mt-3 space-y-3">{saved.outputs.map((field, index) => <div key={`${index}:${field.key}`} className="min-w-0 rounded-lg bg-slate-50 p-3"><dt className="mb-2 break-words text-xs font-semibold text-slate-600">{field.label}</dt><dd className="min-w-0"><StructuredRunValue value={field.output} maxEntries={10} /></dd></div>)}</dl> : <p className="mt-3 text-sm text-slate-500">已保存结果为空对象，请结合步骤核对。</p> : <p className="mt-3 text-sm text-slate-500">尚未读到保存的最终结果。请结合任务状态核对，不能当成空交付或检查通过。</p>}</section>
        </div>
        <section className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-semibold text-slate-900">本次报告中的执行证据</h3><p className="mt-2 text-sm text-slate-600">已读到 {report.steps.length} 条步骤、{report.trace.length} 条轨迹、{report.approvals.length} 条人工决定。</p><p className="mt-1 text-xs leading-5 text-slate-500">这些是实际保存记录，不是当前草稿推演出的执行路径。完整步骤、轨迹与操作入口可到运行详情核对。</p></section>
        {state.status !== "ready" ? <p className="text-xs leading-5 text-amber-800">下方保留上次已核对的报告，不是本次重新读取成功；当前暂停画布定位。</p> : null}
        {locateError ? <p role="alert" className="text-sm leading-6 text-amber-900">{locateError}</p> : null}
        <ExecutionEvidenceSteps key={report.run.id} report={report} onLocate={!overviewScope && state.status === "ready" ? locateStep : undefined} />
        <details className="min-w-0"><summary className="cursor-pointer text-sm text-slate-500">查看本次报告（开发者数据）</summary><pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">{JSON.stringify(redactSensitiveData(report), null, 2)}</pre></details>
        <p className="text-xs leading-5 text-slate-500">{overviewScope ? "这里仅核对已保存记录；编辑样例或重新验收，请回到助手工作台。" : "离开助手工作台不会保存尚未提交的样例，请先关闭证据窗口并完成保存。"}</p>
        <div className="flex justify-end border-t border-slate-100 pt-4"><Link prefetch={false} href={overviewScope ? acceptanceRunDetailHref(agentId, run.id, navigation, overviewScope) : evaluationRunDetailHref(agentId, run.id, navigation)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">打开运行详情</Link></div>
      </> : null}
    </div>
  </ReadOnlyDialog>;
}

export function EvaluationRunEvidence(props: Parameters<typeof EvaluationRunEvidenceSession>[0]) {
  return <EvaluationRunEvidenceSession key={`${props.agentId}:${props.version}:${props.result.caseId}:${props.result.runId ?? "missing"}`} {...props} />;
}
