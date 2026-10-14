import { use, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { RunSummary, type RunReportFile, type RunStepReport } from "@/contracts/run";
import { RunStatusBadge } from "@/features/runs/RunList";
import { StructuredRunValue } from "@/features/runs/StructuredRunValue";
import { redactSensitiveData, redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { checkedNodeEvidenceReport, evidenceStepLabel, sameEvidenceUuid } from "./execution-evidence";

const INTERNAL_KEYS = new Set(["id", "runId", "parentRunId", "childRunId", "workflowRunId", "workflowId", "nodeId", "nodeIds", "agentId", "versionId", "workspaceId", "createdBy", "sourceId", "connectionId", "stepId", "eventKey"]);
const CONDITION_KEYS = new Set([...INTERNAL_KEYS, "next", "matched"]);
const SOURCE_LABELS = { manual: "手动任务", schedule: "定时任务", agent_call: "助手调用", handoff: "助手交接", evaluation: "自动验收任务" };
const STEP_LABELS: Record<string, string> = { pending: "待执行", running: "运行中", succeeded: "已完成", failed: "执行失败" };

function savedTime(value: string | null): string {
  if (!value) return "时间尚未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间暂不可读" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function StepOutput({ step }: { step: RunStepReport }) {
  if (step.output === null || step.output === undefined) return <p className="text-xs text-slate-500">未读到保存的步骤产出，不从当前草稿补造内容。</p>;
  let safe: unknown;
  try { safe = redactSensitiveData(step.output); } catch { return <p className="text-xs text-amber-800">步骤产出暂不可显示，请到运行详情核对。</p>; }
  const empty = safe === "" ? "已保存空文字。" : Array.isArray(safe) && safe.length === 0 ? "已保存空列表。" : safe && typeof safe === "object" && !Array.isArray(safe) && Object.keys(safe).length === 0 ? "已保存空对象。" : null;
  return <div className="min-w-0 space-y-2 rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">已保存的步骤产出预览；每层最多十项，不是最终交付或验收通过结论。</p>{empty ? <p className="text-xs text-slate-600">{empty}</p> : <StructuredRunValue value={safe} maxEntries={10} excludedKeys={step.nodeType === "condition" ? CONDITION_KEYS : INTERNAL_KEYS} />}</div>;
}

export function ExecutionEvidenceSteps({ report, nodeId, onLocate }: { report: RunReportFile; nodeId?: string; onLocate?: (nodeId: string) => void }) {
  const [failedOnly, setFailedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const scoped = report.steps.filter((step) => nodeId === undefined || step.nodeId === nodeId);
  const matching = scoped.filter((step) => !failedOnly || step.status === "failed");
  const lastPage = Math.max(1, Math.ceil(matching.length / 20));
  const shownPage = Math.min(page, lastPage);
  const visible = matching.slice((shownPage - 1) * 20, shownPage * 20);
  return <section aria-label="历史步骤执行证据" className="min-w-0 space-y-3">
    <p className="text-xs leading-5 text-slate-600">以下来自所选任务的已保存记录，历史版本可能与当前草稿不同；相同关联步骤也不证明业务行为或版本一致。</p>
    <div className="flex flex-wrap items-center justify-between gap-2"><label className="flex gap-2 text-xs text-slate-700"><input type="checkbox" checked={failedOnly} onChange={(event) => { setFailedOnly(event.target.checked); setPage(1); }} />只看明确执行失败的步骤</label><p className="text-xs text-slate-500">本次读到 {scoped.length} 条，当前显示 {visible.length} 条</p></div>
    {report.integrity ? <p className="text-xs text-slate-500">报告中无法按契约导出的步骤计数为 {report.integrity.omittedSteps}；这不证明流程覆盖完整，也不会补造记录。</p> : <p className="text-xs text-slate-500">这份报告未提供步骤遗漏计数，不能据此确认原始记录完整。</p>}
    {visible.length ? <ol className="space-y-3">{visible.map((step, index) => <li key={`${shownPage}:${index}`} className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="min-w-0 break-words text-sm font-semibold text-slate-900">{evidenceStepLabel(step, (shownPage - 1) * 20 + index)}</h4><span className={`text-xs font-semibold ${step.status === "failed" ? "text-red-700" : "text-slate-600"}`}>{STEP_LABELS[step.status] ?? "状态未知"}</span></div>
      <p className="text-xs text-slate-500">{savedTime(step.startedAt)} · {step.attempt !== null && step.attempt > 0 ? `已记录 ${step.attempt} 次尝试` : "尝试次数尚未记录"}</p>
      {step.error ? <p className="whitespace-pre-wrap break-words text-xs leading-5 text-red-700">{redactSensitiveText(step.error)}</p> : step.status === "failed" ? <p className="text-xs text-amber-800">已标记执行失败，但没有保存失败原因；不能据此猜测原因。</p> : null}
      <StepOutput step={step} />
      {onLocate ? <button type="button" onClick={() => onLocate(step.nodeId)} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700">在当前草稿中查找此步骤</button> : null}
    </li>)}</ol> : <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs leading-5 text-slate-600">{failedOnly ? "这份报告的当前范围没有明确执行失败的步骤，不代表样例检查通过。" : "这份报告没有读到当前范围的步骤记录，可能版本不同或记录不完整，不能判断从未执行。"}</p>}
    {lastPage > 1 ? <nav aria-label="历史步骤记录分页" className="flex items-center justify-between text-xs"><button type="button" disabled={shownPage === 1} onClick={() => setPage(shownPage - 1)} className="font-semibold text-indigo-700 disabled:text-slate-400">上一页步骤记录</button><span>第 {shownPage} / {lastPage} 页</span><button type="button" disabled={shownPage === lastPage} onClick={() => setPage(shownPage + 1)} className="font-semibold text-indigo-700 disabled:text-slate-400">下一页步骤记录</button></nav> : null}
  </section>;
}

function NodeEvidenceSession({ agentId, nodeId, rows }: { agentId: string; nodeId: string; rows: RunSummary[] | null }) {
  const [selected, setSelected] = useState<RunSummary | null>(null);
  const selectedRef = useRef<RunSummary | null>(null);
  const [report, setReport] = useState<RunReportFile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [open, setOpen] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const nonce = useRef(0);
  const busy = useRef(false);
  const parsed = rows === null ? null : RunSummary.array().safeParse(rows);
  const options = parsed?.success && parsed.data.every((row) => sameEvidenceUuid(row.agentId, agentId)) && new Set(parsed.data.map((row) => row.id.toLowerCase())).size === parsed.data.length ? parsed.data : null;
  const currentOptions = useRef(options);
  useLayoutEffect(() => { currentOptions.current = options; });
  useLayoutEffect(() => {
    active.current = true;
    generation.current += 1;
    return () => { active.current = false; generation.current += 1; nonce.current += 1; request.current?.abort(); busy.current = false; };
  }, [agentId, nodeId]);

  function stopRead() { nonce.current += 1; request.current?.abort(); request.current = null; busy.current = false; setReading(false); }
  async function read(selectedRun: RunSummary) {
    if (!active.current || busy.current || selectedRef.current !== selectedRun || !currentOptions.current?.some((row) => sameEvidenceUuid(row.id, selectedRun.id) && row.sourceType === selectedRun.sourceType && row.version === selectedRun.version)) return;
    busy.current = true;
    const owner = generation.current;
    const sequence = ++nonce.current;
    const controller = new AbortController();
    request.current = controller;
    const current = () => active.current && generation.current === owner && nonce.current === sequence && !controller.signal.aborted;
    setReading(true); setMessage(null);
    const timeout = window.setTimeout(() => {
      if (!current()) return;
      controller.abort(); busy.current = false; setReading(false);
      setMessage("报告读取超时；原报告如已读取仍保留，可以手动重新读取，没有执行任务。");
    }, 30_000);
    try {
      const response = await fetch(`/api/runs/${selectedRun.id}/export`, { method: "GET", cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!current()) return;
      if (!response.ok) { setMessage("报告暂时无法读取，不能判断记录不存在；原报告如已读取仍保留。"); return; }
      const next = checkedNodeEvidenceReport(await response.json(), agentId, selectedRun);
      if (!current()) return;
      if (!currentOptions.current?.some((row) => sameEvidenceUuid(row.id, selectedRun.id) && row.sourceType === selectedRun.sourceType && row.version === selectedRun.version)) { setMessage("近期任务来源已经变化，本次回执未应用；原报告如已读取仍保留。"); return; }
      if (!next) { setMessage("报告格式或任务归属无法核对，本次内容未应用；原报告如已读取仍保留。"); return; }
      setReport(next);
    } catch { if (current()) setMessage("网络或报告内容暂时无法确认，原报告如已读取仍保留；可以手动重新读取。"); }
    finally { window.clearTimeout(timeout); if (current()) { busy.current = false; setReading(false); request.current = null; } }
  }

  const selectedKnown = selected && options?.some((row) => sameEvidenceUuid(row.id, selected.id) && row.sourceType === selected.sourceType && row.version === selected.version);
  return <details open={open} onToggle={(event) => {
    const next = event.currentTarget.open;
    setOpen(next);
    if (!next && active.current) stopRead();
  }} className="mt-3 min-w-0 rounded-2xl border border-slate-200 bg-white p-4" aria-label="所选步骤的历史执行证据">
    <summary className="cursor-pointer text-sm font-semibold text-slate-900">核对所选步骤的历史执行证据</summary>
    <div className="mt-3 min-w-0 space-y-3">
      <p className="text-xs leading-5 text-slate-600">只核对所选近期任务中的步骤历史，不是此步骤最近三十次执行；不会运行、保存或改变当前草稿。</p>
      {options === null ? <p className="text-xs leading-5 text-amber-800">近期任务清单暂时无法核对，数量未知，不能当成没有任务。原报告如已读取仍保留，可重新读取工作台后核对清单。</p> : !options.length ? <p className="text-xs text-slate-500">本次近期任务清单为空，不能判断此步骤从未执行。</p> : null}
      <label className="grid gap-1 text-xs text-slate-700">选择近期任务<select aria-label="选择近期任务核对步骤" value={selected?.id ?? ""} disabled={!options || !options.length} onChange={(event) => {
        if (!active.current || !currentOptions.current) return;
        const next = currentOptions.current.find((row) => row.id === event.target.value) ?? null;
        if (next && selectedRef.current && sameEvidenceUuid(next.id, selectedRef.current.id)) return;
        stopRead(); selectedRef.current = next; setSelected(next); setReport(null); setMessage(null);
        if (next) void read(next);
      }} className="h-10 min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-xs">
        <option value="">手动选择一条已保存任务</option>
        {selected && !selectedKnown ? <option value={selected.id}>原选择的来源暂不可核对</option> : null}
        {options?.map((row, index) => <option key={row.id} value={row.id}>{`近期任务 ${index + 1} · ${SOURCE_LABELS[row.sourceType]} · ${row.version === null ? "版本编号未知" : `版本 V${row.version}`} · ${savedTime(row.startedAt)}`}</option>)}
      </select></label>
      {selected ? <button type="button" disabled={reading || !selectedKnown} onClick={() => { if (selectedKnown) void read(selected); }} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 disabled:text-slate-400">重新读取所选任务报告</button> : null}
      {reading ? <p role="status" className="text-xs text-indigo-700">正在读取所选任务报告，没有执行任务…</p> : null}
      {message ? <p role="alert" className="text-xs leading-5 text-amber-900">{message}</p> : null}
      {report ? <><p className="text-xs text-slate-600">历史任务状态：<RunStatusBadge status={report.run.status} /> · {report.run.version === null ? "历史版本编号未知" : `历史版本 V${report.run.version}`}。执行完成不代表业务验收通过。</p><ExecutionEvidenceSteps key={report.run.id} report={report} nodeId={nodeId} /><Link prefetch={false} href={`/runs/${report.run.id}`} className="inline-block text-xs font-semibold text-indigo-700">打开这次运行的完整记录</Link></> : selected && !reading && !message ? <p className="text-xs text-slate-500">尚未读到报告，请手动重新读取。</p> : null}
    </div>
  </details>;
}

export function NodeExecutionEvidence({ agentId, nodeId, recentRuns }: { agentId: string; nodeId: string; recentRuns: RunSummary[] | null | Promise<RunSummary[] | null> }) {
  const rows = recentRuns === null || Array.isArray(recentRuns) ? recentRuns : use(recentRuns);
  return <NodeEvidenceSession key={`${agentId}:${nodeId}`} agentId={agentId} nodeId={nodeId} rows={rows} />;
}
