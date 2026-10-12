"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ToolOperationResolveInput, ToolOperationView } from "@/contracts/tool-operation";
import { readToolOperation, submitToolOperationResolution } from "./tool-operation-client";
import { createToolOperationResolution, operationText } from "./tool-operation-presentation";
import { toolOperationRequestHash } from "./tool-operation-request-hash";
import { ToolOperationHistoryReader, type ToolOperationHistoryReadState } from "./ToolOperationHistoryReader";
import { copyToolOperationReadPayload } from "./tool-operation-read-evidence";

type Attempt = { payload: ToolOperationResolveInput; sourceRunId: ToolOperationView["sourceRunId"]; generation: number; ownerEpoch: number; bindingValid: boolean; registered: boolean; phase: "sending" | "uncertain" | "checking" | "recorded" | "rejected"; canResend: boolean; message: string };
const fieldClass = "mt-2 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:bg-slate-50";

export function ToolOperationReconciliationForm({ operation, onLockChange, onObserved }: {
  operation: ToolOperationView; onLockChange: (locked: boolean) => void; onObserved: (operation: ToolOperationView) => void;
}) {
  const [kind, setKind] = useState<ToolOperationResolveInput["kind"]>("record-receipt");
  const [reason, setReason] = useState("");
  const [receipt, setReceipt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState<ToolOperationResolveInput | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [resendOpen, setResendOpen] = useState(false);
  const inFlight = useRef(false);
  const candidateSnapshot = useRef("");
  const candidateOwnerEpoch = useRef(0);
  const mounted = useRef(true);
  const attemptRef = useRef<Attempt | null>(null);
  const generation = useRef(0);
  const owner = useRef({ id: operation.id, sourceRunId: operation.sourceRunId, epoch: 0 });
  const observed = useRef(onObserved);
  const submitButton = useRef<HTMLButtonElement>(null);
  const resendButton = useRef<HTMLButtonElement>(null);
  const locked = candidate !== null || attempt?.phase === "sending" || attempt?.phase === "uncertain" || attempt?.phase === "checking";

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!locked) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [locked]);

  const update = useCallback((next: Attempt) => {
    attemptRef.current = next;
    setAttempt(next);
    onLockChange(next.phase === "sending" || next.phase === "uncertain" || next.phase === "checking");
  }, [onLockChange]);

  useLayoutEffect(() => {
    observed.current = onObserved;
    if (owner.current.id === operation.id && owner.current.sourceRunId === operation.sourceRunId) return;
    owner.current = { id: operation.id, sourceRunId: operation.sourceRunId, epoch: owner.current.epoch + 1 };
    const current = attemptRef.current;
    if (current) update({ ...current, bindingValid: false, phase: "uncertain", canResend: false, message: "当前记录所属任务已变化，原请求仍保留且结果未知。请联系维护人员核对，不能将新详情作为原提交证据。" });
  }, [operation.id, operation.sourceRunId, onObserved, update]);

  const currentAttempt = useCallback((payload: ToolOperationResolveInput, sourceRunId: ToolOperationView["sourceRunId"], requestGeneration: number) => {
    const current = attemptRef.current;
    if (!mounted.current || !current?.bindingValid || current.generation !== requestGeneration || current.ownerEpoch !== owner.current.epoch
      || current.payload.operationId !== owner.current.id || current.sourceRunId !== owner.current.sourceRunId
      || sourceRunId !== current.sourceRunId || JSON.stringify(current.payload) !== JSON.stringify(payload)) return null;
    return current;
  }, []);

  const acceptRecorded = useCallback((next: ToolOperationView, payload: ToolOperationResolveInput, sourceRunId: ToolOperationView["sourceRunId"], requestGeneration: number) => {
    const current = currentAttempt(payload, sourceRunId, requestGeneration);
    const records = next.resolutions.filter((record) => record.requestId === payload.requestId);
    if (!current || current.phase === "sending" || next.id !== payload.operationId || next.sourceRunId !== sourceRunId
      || next.resolutions.length >= 50 || records.length !== 1 || records[0].kind !== payload.kind) return;
    observed.current(next);
    update({ ...current, registered: true, phase: "recorded", canResend: false, message: "已在最新历史中找到本次核对记录。这里只确认结论已登记；旧任务未恢复，也未创建新运行。" });
  }, [currentAttempt, update]);

  const acceptUnconfirmed = useCallback((next: ToolOperationView, payload: ToolOperationResolveInput, sourceRunId: ToolOperationView["sourceRunId"], requestGeneration: number, requestHash: string | null) => {
    const current = currentAttempt(payload, sourceRunId, requestGeneration);
    if (!current || current.phase !== "checking" || next.id !== payload.operationId || next.sourceRunId !== sourceRunId || next.resolutions.length >= 50) return;
    observed.current(next);
    if (current.registered) {
      update({ ...current, phase: "recorded", canResend: false, message: "本次核对已有保存确认；最新可读历史未匹配原请求，不据此否定保存或重发。旧任务未恢复，也未创建新运行。" });
      return;
    }
    const canResend = requestHash !== null && /^[a-f0-9]{64}$/.test(requestHash)
      && !next.resolutions.some((record) => record.requestId === payload.requestId) && next.status !== "completed"
      && (payload.kind !== "retry" || Date.parse(next.retryDeadline) > Date.now());
    update({ ...current, phase: "uncertain", canResend, message: canResend
      ? "最新历史中尚未找到本次记录，仍不能确认本次提交，也不能据此断定保存失败。原内容已保留，可再次确认后重发同一次核对请求。"
      : "最新记录仍不能确认本次提交，当前不宜重发。原内容已保留，请联系维护人员核对。" });
  }, [currentAttempt, update]);

  const acceptReadState = useCallback((state: ToolOperationHistoryReadState) => {
    const current = attemptRef.current;
    if (!mounted.current || !current?.bindingValid || current.ownerEpoch !== owner.current.epoch || current.phase === "sending") return;
    if (state.phase === "reading" || state.phase === "slow") {
      if (current.phase !== "checking" || current.message !== state.message) update({ ...current, phase: "checking", canResend: false, message: state.message });
    } else if (state.phase === "unknown" && current.phase === "checking") {
      update({ ...current, phase: current.registered ? "recorded" : "uncertain", canResend: false, message: current.registered
        ? "原核对结论已有保存确认，但本次最新历史读取未完成或无法核对。保存确认仍保留，不重发原请求。"
        : state.message });
    }
  }, [update]);

  function prepare(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || attempt || candidate) return;
    try {
      let requestId: string;
      try { requestId = globalThis.crypto.randomUUID(); }
      catch { throw new Error("当前浏览器无法生成安全的核对请求。请在安全连接中打开页面后重试。"); }
      const input = createToolOperationResolution(operation, kind, reason, receipt, confirmed, requestId);
      candidateSnapshot.current = JSON.stringify(operation);
      candidateOwnerEpoch.current = owner.current.epoch;
      setCandidate(input); setError(""); onLockChange(true);
    } catch (cause) {
      setError(cause instanceof Error ? operationText(cause.message, operation) : "核对内容无法确认，请检查。");
    }
  }

  async function submit(payload: ToolOperationResolveInput) {
    if (inFlight.current) return;
    if (payload.operationId !== operation.id || candidate && (candidateSnapshot.current !== JSON.stringify(operation) || candidateOwnerEpoch.current !== owner.current.epoch)) {
      setCandidate(null); setError("当前记录已发生变化，请重新读取后核对。"); onLockChange(false); return;
    }
    const previous = attemptRef.current;
    if (previous && (!previous.bindingValid || previous.ownerEpoch !== owner.current.epoch)) return;
    const fixed = previous ?? { payload: copyToolOperationReadPayload(payload), sourceRunId: operation.sourceRunId, generation: ++generation.current, ownerEpoch: owner.current.epoch, bindingValid: true, registered: false };
    inFlight.current = true; setCandidate(null); setResendOpen(false);
    update({ ...fixed, phase: "sending", canResend: false, message: "正在保存核对结论，请保留当前页面。" });
    const result = await submitToolOperationResolution(fixed.payload);
    if (currentAttempt(fixed.payload, fixed.sourceRunId, fixed.generation)) update(result.ok
      ? { ...fixed, registered: true, phase: "recorded", canResend: false, message: "核对记录已保存。旧任务未恢复，也未创建新运行。请读取最新记录查看历史。" }
      : { ...fixed, phase: result.retryable ? "uncertain" : "rejected", canResend: false, message: operationText(result.error, operation) });
    inFlight.current = false;
  }

  if (!attempt && !candidate && operation.status === "completed") return <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">本记录已确认完成，仅展示已有结果和历史。</p>;
  if (!attempt && !candidate && operation.resolutions.length >= 50) return <p role="alert" className="mt-5 text-sm text-amber-900">核对记录已达到上限，请联系维护人员处理。</p>;

  return <section aria-label="填写核对结论" className="mt-6 border-t border-slate-200 pt-5">
    <h3 className="font-bold text-slate-900">填写人工核对结论</h3>
    <p className="mt-2 text-xs leading-5 text-slate-600">先查询业务系统，再填写依据。保存只登记结论；允许之后重新尝试也不会立即调用业务工具。服务端会检查当前配置、执行占用、期限和回执字段。</p>
    {attempt ? <div className="mt-4 space-y-3">
      <p role={attempt.phase === "uncertain" || attempt.phase === "rejected" ? "alert" : "status"} aria-live="polite" className="rounded-xl bg-slate-50 p-4 text-sm leading-6">{attempt.message}</p>
      <p className="text-xs text-slate-500">本次核对内容已固定：{attempt.payload.kind === "retry" ? "确认未执行" : "记录实际回执"}。等待期间请保留此页，离开后需先读取历史再核对。</p>
      <div className="flex flex-wrap gap-2">
        {attempt.phase === "uncertain" ? <button ref={resendButton} className={buttonVariants()} type="button" disabled={!attempt.canResend} onClick={() => setResendOpen(true)}>重发同一次核对请求</button> : null}
        {attempt.phase === "rejected" ? <Button type="button" variant="secondary" onClick={() => { attemptRef.current = null; setAttempt(null); setConfirmed(false); setError(""); onLockChange(false); }}>返回修改核对内容</Button> : null}
      </div>
      <ToolOperationHistoryReader payload={attempt.payload} sourceRunId={attempt.sourceRunId} requestGeneration={attempt.generation}
        readEnabled={attempt.bindingValid && attempt.phase !== "sending" && !resendOpen && attempt.payload.operationId === operation.id && attempt.sourceRunId === operation.sourceRunId}
        read={readToolOperation} hashPayload={toolOperationRequestHash} onRecorded={acceptRecorded} onUnconfirmed={acceptUnconfirmed}
        onStateChange={acceptReadState} readLabel="核对最新记录" announce={false} knownRecorded={attempt.registered} />
    </div> : <form onSubmit={prepare} className="mt-4 space-y-4">
      <fieldset disabled={candidate !== null} className="space-y-4">
        <label className="block text-sm font-semibold">业务系统查询结果
          <select className={fieldClass} value={kind} onChange={(event) => { setKind(event.target.value as ToolOperationResolveInput["kind"]); setConfirmed(false); }}>
            <option value="record-receipt">确定已完成，登记实际回执</option>
            <option value="retry" disabled={Date.parse(operation.retryDeadline) <= openedAt}>确定未执行，允许之后重新尝试</option>
          </select>
        </label>
        <label className="block text-sm font-semibold">核对依据
          <textarea className={fieldClass} rows={3} value={reason} minLength={5} maxLength={500} required onChange={(event) => setReason(event.target.value)} placeholder="填写业务记录、查询时间和实际查询结果" />
        </label>
        {kind === "record-receipt" ? <label className="block text-sm font-semibold">实际业务回执
          <textarea className={fieldClass} rows={6} value={receipt} required onChange={(event) => setReceipt(event.target.value)} placeholder="粘贴业务系统返回的对象内容，须符合原工具结果字段" />
          <span className="mt-1 block text-xs font-normal text-slate-500">仅接收对象格式，大小和层级按现有契约校验；不会替你补造业务结果。</span>
        </label> : null}
        <label className="flex items-start gap-2 text-sm leading-6">
          <input type="checkbox" className="mt-1 size-4" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          {kind === "retry" ? "我已在业务系统确认本次操作未执行" : "我已在业务系统确认本次操作已完成，回执来自实际记录"}
        </label>
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <button ref={submitButton} className={buttonVariants()} type="submit" disabled={!confirmed}>检查并保存核对结论</button>
      </fieldset>
    </form>}
    <ConfirmDialog open={candidate !== null} onOpenChange={(open) => { if (!open) { setCandidate(null); onLockChange(false); } }} title="保存这份核对结论？"
      description="请确认依据与业务系统一致。此操作只登记人工结论，不会恢复旧任务或立即执行业务工具。" confirmLabel="确认保存核对结论" tone="warning" returnFocusRef={submitButton}
      onConfirm={() => { if (candidate) void submit(candidate); }} />
    <ConfirmDialog open={resendOpen} onOpenChange={setResendOpen} title="重发同一次核对请求？"
      description="最新历史尚未确认保存结果。本次将保留原请求与全部内容，不会生成新的核对请求。" confirmLabel="确认重发原核对请求" tone="warning" returnFocusRef={resendButton}
      onConfirm={() => { if (attempt?.phase === "uncertain" && attempt.canResend) void submit(attempt.payload); }} />
  </section>;
}
