"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  ExecutionPolicyInput, ExecutionResourceLimits,
  type ExecutionPolicyReadResult, type ExecutionPolicyHistoryResult,
  type ExecutionPolicyWriteResult, type ExecutionPolicyChangeView,
} from "@/contracts/execution-resources";
import { readExecutionResources, readExecutionResourceHistory, writeExecutionResources } from "./execution-resource-client";

const fields = [
  { key: "maxConcurrentChains", label: "同时保留的执行链名额", min: 1, max: 2000 },
  { key: "maxModelCalls", label: "每条执行链的模型调用上限", min: 1, max: 10000 },
  { key: "maxChildRuns", label: "每条执行链的协作任务上限", min: 0, max: 199 },
] as const;

function resourceTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(value));
}

function draftFrom(read: ExecutionPolicyReadResult): { [K in keyof ExecutionResourceLimits]: string } {
  return {
    maxConcurrentChains: read.ok ? String(read.snapshot.policy.limits.maxConcurrentChains) : "",
    maxModelCalls: read.ok ? String(read.snapshot.policy.limits.maxModelCalls) : "",
    maxChildRuns: read.ok ? String(read.snapshot.policy.limits.maxChildRuns) : "",
  };
}

export function ExecutionResourcesPanel({ initialRead, initialHistory }: {
  initialRead: ExecutionPolicyReadResult;
  initialHistory: ExecutionPolicyHistoryResult;
}) {
  const [readSource, setReadSource] = useState(initialRead);
  const [read, setRead] = useState(initialRead);
  const [historySource, setHistorySource] = useState(initialHistory);
  const [history, setHistory] = useState(initialHistory);
  const [cursor, setCursor] = useState<number | undefined>();
  const [previousCursors, setPreviousCursors] = useState<(number | undefined)[]>([]);
  const [reading, setReading] = useState(false);
  const [readingHistory, setReadingHistory] = useState(false);
  const readSequence = useRef(0);
  const historySequence = useRef(0);
  const [draft, setDraft] = useState(() => draftFrom(initialRead));
  const [draftRevision, setDraftRevision] = useState<number | null>(initialRead.ok ? initialRead.snapshot.policy.revision : null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<ExecutionPolicyInput | null>(null);
  const frozenRef = useRef<ExecutionPolicyInput | null>(null);
  const writeLock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<ExecutionPolicyWriteResult | null>(null);
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [matchedRecord, setMatchedRecord] = useState<ExecutionPolicyChangeView | null>(null);

  if (readSource !== initialRead) {
    setReadSource(initialRead);
    setRead(initialRead);
  }
  if (historySource !== initialHistory) {
    setHistorySource(initialHistory);
    if (cursor === undefined) setHistory(initialHistory);
  }

  async function reloadRead() {
    const sequence = ++readSequence.current;
    setReading(true);
    const result = await readExecutionResources();
    if (sequence === readSequence.current) { setRead(result); setReading(false); }
    return result;
  }
  async function reloadHistory(before: number | undefined) {
    const sequence = ++historySequence.current;
    setReadingHistory(true);
    setCursor(before);
    const result = await readExecutionResourceHistory(before);
    if (sequence === historySequence.current) { setHistory(result); setReadingHistory(false); }
    return result;
  }
  async function inspectResult() {
    if (writeLock.current || checking) return;
    setChecking(true);
    setChecked(false);
    setMatchedRecord(null);
    setPreviousCursors([]);
    const [current, recent] = await Promise.all([reloadRead(), reloadHistory(undefined)]);
    const request = frozenRef.current;
    if (request && recent.ok) {
      const record = recent.items.find((item) => item.requestId === request.requestId);
      if (record && record.revision === request.expectedRevision + 1
        && fields.every((field) => record.limits[field.key] === request.limits[field.key])) setMatchedRecord(record);
    }
    setChecked(current.ok && recent.ok);
    setChecking(false);
  }
  async function attempt(payload: ExecutionPolicyInput) {
    if (writeLock.current) return;
    writeLock.current = true;
    setSaving(true);
    setChecked(false);
    setMatchedRecord(null);
    setOutcome(null);
    try {
      const result = await writeExecutionResources(payload);
      setOutcome(result);
      if (result.ok) {
        setPreviousCursors([]);
        const [current, recent] = await Promise.all([reloadRead(), reloadHistory(undefined)]);
        setChecked(current.ok && recent.ok);
      }
    } finally {
      writeLock.current = false;
      setSaving(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writeLock.current || frozenRef.current || reading) return;
    if (!read.ok || draftRevision === null) { setFormError("请先读取当前资源设置，再明确填写与确认。"); return; }
    const limits = ExecutionResourceLimits.safeParse(Object.fromEntries(fields.map((field) => [field.key, /^\d+$/.test(draft[field.key]) ? Number(draft[field.key]) : Number.NaN])));
    if (!limits.success || !ExecutionPolicyInput.shape.reason.safeParse(reason).success || !confirmed) {
      setFormError("请填写范围内的三个整数上限、修改原因，并勾选明确确认。"); return;
    }
    let requestId: string;
    try { requestId = crypto.randomUUID(); }
    catch { setFormError("当前无法创建安全的保存请求，请保持内容并稍后重试。"); return; }
    const parsed = ExecutionPolicyInput.safeParse({ requestId, expectedRevision: draftRevision, confirmed: true, limits: limits.data, reason });
    if (!parsed.success) { setFormError("这组设置无法提交，请重新读取当前设置后填写。"); return; }
    const payload = parsed.data;
    Object.freeze(payload.limits);
    Object.freeze(payload);
    frozenRef.current = payload;
    setFrozen(payload);
    setDraft({ maxConcurrentChains: String(payload.limits.maxConcurrentChains), maxModelCalls: String(payload.limits.maxModelCalls), maxChildRuns: String(payload.limits.maxChildRuns) });
    setReason(payload.reason);
    setFormError(null);
    void attempt(payload);
  }
  function beginNew() {
    if (!read.ok || reading || saving || checking || (frozen && !checked)) return;
    frozenRef.current = null;
    setFrozen(null);
    setDraft(draftFrom(read));
    setDraftRevision(read.snapshot.policy.revision);
    setReason("");
    setConfirmed(false);
    setOutcome(null);
    setMatchedRecord(null);
    setFormError(null);
    setChecked(false);
  }
  const canEdit = !frozen && read.ok && !reading && !saving;
  const uncertain = outcome && !outcome.ok && outcome.retryable;
  const snapshot = read.ok ? read.snapshot : null;

  return <section id="execution-resources" aria-labelledby="execution-resources-title" className="content-card min-w-0 scroll-mt-24">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="execution-resources-title" className="section-title">资源限额与变更记录</h2><p className="mt-1 text-sm leading-6 text-slate-500">核对当前执行链名额、调用次数和协作数量的上限，再明确提交修改。</p></div>
      <button type="button" onClick={() => void reloadRead()} disabled={reading || saving || checking} aria-busy={reading} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">{reading ? "正在读取资源…" : "重新读取资源摘要"}</button>
    </div>
    <p className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-950">这是当前资源准入设置，不能追溯说明过去某次运行用了什么上限。模型与协作上限按任务保存的资源记录核对；这里不管理工具授权规则，也不是费用预算或供应商账单。</p>
    {reading ? <p role="status" className="mt-4 text-sm text-slate-600">正在重新核对资源摘要，暂不将上次读数作为当前值。</p> : !snapshot ? <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">资源摘要暂时无法读取，当前上限与可用名额未知。历史如可读取仍可核对，当前不能填写新的设置。</p> : <div aria-label="本次资源摘要" className="mt-4">
      <p className="text-sm font-semibold text-slate-900">{snapshot.policy.source === "default" ? "服务端默认设置" : "已保存的资源设置 · 第 " + snapshot.policy.revision + " 版"}</p>
      <p className="mt-1 text-xs text-slate-500">读取时间：{resourceTime(snapshot.assessedAt)} · 北京时间{snapshot.policy.updatedAt ? "；设置保存时间：" + resourceTime(snapshot.policy.updatedAt) : ""}</p>
      <dl className="mt-3 grid gap-3 lg:grid-cols-3">
        {[{ label: "已保留执行链名额", value: snapshot.capacity.reservedChains }, { label: "其中未确认完整关联的活跃任务", value: snapshot.capacity.untrackedActiveRuns }, { label: "本次读取的可用名额", value: snapshot.capacity.availableSlots }].map((item) => <div key={item.label} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs leading-5 text-slate-600">{item.label}</dt><dd className="mt-1 text-xl font-semibold text-slate-950">{item.value}</dd></div>)}
      </dl>
      <p className="mt-2 text-xs leading-5 text-slate-500">排队、执行、人工确认和等待中的任务仍可能保留名额；无法确认完整关联的活跃任务已保守计入，不是额外可用名额。</p>
      <dl className="mt-3 grid gap-3 lg:grid-cols-3">{fields.map((field) => <div key={field.key}><dt className="text-xs leading-5 text-slate-600">{field.label}</dt><dd className="mt-1 font-semibold text-slate-900">{snapshot.policy.limits[field.key]}</dd></div>)}</dl>
    </div>}
    <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-2">
      <form aria-label="修改资源限额" onSubmit={submit} className="min-w-0 rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">修改资源限额</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">{draftRevision === null ? "未读到资源设置，不预填默认数值。" : "本次填写基于第 " + draftRevision + " 版设置。保存时由服务端核对版本，不自动覆盖他人的更新。"}</p>
        {snapshot && draftRevision !== null && draftRevision !== snapshot.policy.revision ? <p className="mt-2 text-xs leading-5 text-amber-900">摘要版本已变化，当前填写仍基于原版本。请核对后重新填写，不能自动换版本提交。</p> : null}
        <fieldset disabled={!canEdit} className="mt-4 space-y-3">
          {fields.map((field) => <label key={field.key} className="block"><span className="text-xs font-medium text-slate-700">{field.label}</span><input type="number" aria-label={field.label} required min={field.min} max={field.max} step={1} value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50" /><span className="mt-1 block text-xs text-slate-500">{field.min}–{field.max}，只接受整数</span></label>)}
          <label className="block"><span className="text-xs font-medium text-slate-700">修改原因</span><textarea required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 p-3 text-sm disabled:bg-slate-50" /></label>
          <label className="flex items-start gap-2 text-xs leading-5 text-slate-700"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" /><span>我已核对三个上限、修改原因和当前版本，明确确认记录这次资源设置。</span></label>
        </fieldset>
        {formError ? <p role="alert" className="mt-3 text-sm text-amber-900">{formError}</p> : null}
        {!frozen ? <div className="mt-4 flex flex-wrap gap-3"><button type="submit" disabled={!canEdit} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">确认并保存资源设置</button><button type="button" onClick={beginNew} disabled={!read.ok || reading} className="px-2 py-2 text-xs font-semibold text-indigo-700 disabled:opacity-50">按当前设置重新填写</button></div> : <div className="mt-4 space-y-3">
          <p className="text-xs leading-5 text-slate-600">这次请求的三个上限、原因和原版本已冻结。核对与原请求重试不会更换这些内容。</p>
          {saving ? <p role="status" className="text-sm text-indigo-900">正在提交并核对保存回执…</p> : outcome?.ok ? <p role="status" className="text-sm leading-6 text-emerald-900">这次请求已记录为第 {outcome.recordedRevision} 版。{outcome.policy.revision > outcome.recordedRevision ? "服务端当前已是第 " + outcome.policy.revision + " 版，这次原请求并未把旧内容重新设为当前值。" : "当前资源读数仍以重新读取的摘要为准。"}</p> : outcome ? <p role="alert" className="text-sm leading-6 text-amber-900">{outcome.error}{outcome.conflict ? " 当前请求不能自动改版本；请先核对最新设置，再明确重新确认新的设置。" : ""}</p> : null}
          {matchedRecord ? <p role="status" className="text-sm leading-6 text-emerald-900">最近历史中已核对到这次原请求的第 {matchedRecord.revision} 版记录。当前上限以摘要读取为准。</p> : checked && frozen && !outcome?.ok ? <p className="text-xs leading-5 text-amber-900">最近这一页没有核对到这次原请求，不能证明保存未发生；记录可能在更早的历史页。</p> : null}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void inspectResult()} disabled={saving || reading || readingHistory || checking} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-indigo-700 disabled:opacity-50">{checking ? "正在核对结果…" : "核对保存结果"}</button>
            {uncertain ? <button type="button" onClick={() => { const request = frozenRef.current; if (request) void attempt(request); }} disabled={saving || checking} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-800 disabled:opacity-50">沿用原请求重试</button> : null}
            <button type="button" onClick={beginNew} disabled={!checked || !read.ok || reading || saving || checking} className="px-2 py-2 text-xs font-semibold text-indigo-700 disabled:opacity-50">重新确认新的设置</button>
          </div>
          {!checked ? <p className="text-xs leading-5 text-slate-500">请先核对当前摘要和最近历史。另开请求需要重新填写原因并再次明确确认，可能记录另一版设置。</p> : null}
        </div>}
        <p className="mt-4 text-xs leading-5 text-slate-500">原请求只在当前页面保留。整页刷新或离开后如丢失原内容，本页不会提供原请求重试；请先核对历史，再重新确认新的设置。不要在原因中填写密钥。</p>
      </form>
      <section aria-labelledby="execution-resource-history-title" className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 id="execution-resource-history-title" className="text-sm font-semibold text-slate-900">资源设置变更历史</h3><button type="button" onClick={() => void reloadHistory(cursor)} disabled={readingHistory || saving || checking} className="text-xs font-semibold text-indigo-700 disabled:opacity-50">重新读取此页历史</button></div>
        <p className="mt-2 text-xs leading-5 text-slate-500">{cursor === undefined ? "当前读取最近一页，最多二十条。" : "当前读取第 " + cursor + " 版之前的一页，最多二十条。"}记录缺失或本页为空不能证明某次保存没有发生。</p>
        {readingHistory ? <p role="status" className="mt-3 text-sm text-slate-600">正在读取本页变更历史…</p> : !history.ok ? <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">资源设置历史暂时无法读取，不能按空记录显示。资源摘要如可读仍可核对。</p> : history.items.length ? <ol className="mt-3 space-y-3">{history.items.map((item) => <li key={item.id} className="rounded-xl border border-slate-200 p-3">
          <h4 className="text-sm font-semibold text-slate-900">资源设置第 {item.revision} 版</h4><p className="mt-1 text-xs text-slate-500">{resourceTime(item.createdAt)} · 北京时间</p>
          {frozen && item.requestId === frozen.requestId && item.revision === frozen.expectedRevision + 1 && fields.every((field) => item.limits[field.key] === frozen.limits[field.key]) ? <p className="mt-2 text-xs font-semibold text-emerald-800">对应当前页面保留的原请求</p> : null}
          <dl className="mt-2 space-y-1 text-xs leading-5">{fields.map((field) => <div key={field.key}><dt className="inline text-slate-600">{field.label}：</dt><dd className="inline text-slate-800">{item.previousLimits[field.key]} → {item.limits[field.key]}</dd></div>)}</dl>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">修改原因：{item.reason}</p>
        </li>)}</ol> : <p role="status" className="mt-3 rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">本页没有已读取的变更记录。</p>}
        <nav aria-label="资源设置历史分页" className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          {previousCursors.length ? <button type="button" disabled={readingHistory || saving || checking} onClick={() => { const previous = previousCursors.at(-1); setPreviousCursors(previousCursors.slice(0, -1)); void reloadHistory(previous); }} className="font-semibold text-indigo-700 disabled:opacity-50">返回较新一页</button> : null}
          {history.ok && history.nextBeforeRevision !== null && !readingHistory ? <button type="button" disabled={saving || checking} onClick={() => { if (!history.ok || history.nextBeforeRevision === null) return; setPreviousCursors([...previousCursors, cursor]); void reloadHistory(history.nextBeforeRevision); }} className="font-semibold text-indigo-700 disabled:opacity-50">读取更早的记录</button> : null}
        </nav>
      </section>
    </div>
  </section>;
}
