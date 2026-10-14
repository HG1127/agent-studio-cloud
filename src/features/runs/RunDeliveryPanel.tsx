"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RunDeliveryResult, RunDeliveryRetryBody, RunDeliveryRetryResult, type RunDeliveryView } from "@/contracts/run-delivery";
import { RunTaskReference } from "@/contracts/run-task";

type ReadState = { kind: "loading" | "unreadable" } | { kind: "ready"; delivery: RunDeliveryView | null; generation: number };
type Attempt = { deliveryId: string; sourceUpdatedAt: string; readGeneration: number; payload: RunDeliveryRetryBody; phase: "sending" | "unknown" | "recorded" | "rejected"; message: string };
type Candidate = { deliveryId: string; sourceUpdatedAt: string; payload: RunDeliveryRetryBody; epoch: number };
const labels = {
  waiting_result: "等待成果", pending: "等待安排发送", queued: "已安排发送，等待执行", sending: "正在发送", delivered: "接收方已确认", failed: "发送已停止，需人工核对",
} satisfies Record<RunDeliveryView["status"], string>;
const unknownMessage = "补投结果尚无法确认。原请求和原因已保留，请先重新读取记录，再按原请求核对；不要另建请求重复提交。";
const leaveMessage = "这次补投正在提交或结果尚未确认。离开会丢失本页保留的原请求，不能取消后台发送。重新打开后请先核对已保存记录，不要按新请求重复提交。确定离开吗？";

function safeReason(raw: string | null): string {
  if (!raw) return "尚未保存可展示的失败原因，请结合接收方记录核对。";
  if (/成果.*契约|快照.*不完整/.test(raw)) return "保存的成果未通过投递校验，请先核对任务结果。";
  if (/防重.*(期限|有效期)|期限.*过/.test(raw)) return "接收方防重有效期已过，不能据此再次发送。";
  if (/配置.*(变化|改变)|接收方.*变化/.test(raw)) return "接收方配置已变化，请由管理员先核对配置。";
  if (/配置|接收方.*不存在/.test(raw)) return "接收方配置无法核对，请联系管理员处理。";
  if (/次数.*上限/.test(raw)) return "人工补投次数已达到上限，请联系管理员处理。";
  if (/无法连接/.test(raw)) return "接收方暂时无法连接，请先核对接收方状态。";
  if (/拒绝/.test(raw)) return "接收方拒绝了投递，请先核对接收条件。";
  if (/回执|明确确认|确认回执/.test(raw)) return "尚未取得可核对的接收确认，请先查询接收方记录。";
  return "本次发送未能确认完成，请结合接收方记录核对原因。";
}

function timeLabel(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（北京时间）" : "尚未记录";
}

function newFailureFor(state: ReadState, previous: Attempt) {
  return state.kind === "ready" && state.delivery !== null && state.delivery.id === previous.deliveryId
    && state.delivery.status === "failed" && state.delivery.updatedAt !== previous.sourceUpdatedAt
    && state.delivery.resolutions.filter((entry) => entry.requestId === previous.payload.requestId).length === 1;
}

function RunDeliverySession({ runId }: { runId: string }) {
  const [readState, setReadState] = useState<ReadState>(() => RunTaskReference.safeParse({ runId }).success ? { kind: "loading" } : { kind: "unreadable" });
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [recheckOpen, setRecheckOpen] = useState(false);
  const active = useRef(false);
  const epoch = useRef(0);
  const reading = useRef<AbortController | null>(null);
  const readGeneration = useRef(0);
  const submissionGeneration = useRef(0);
  const writing = useRef(false);
  const readRef = useRef<ReadState>(readState);
  const candidateRef = useRef<Candidate | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const recheckButton = useRef<HTMLButtonElement>(null);

  const updateAttempt = useCallback((next: Attempt | null) => { attemptRef.current = next; setAttempt(next); }, []);
  const updateRead = useCallback((next: ReadState) => { readRef.current = next; setReadState(next); }, []);

  useLayoutEffect(() => {
    active.current = true;
    epoch.current += 1;
    if (attemptRef.current?.phase === "sending") updateAttempt({ ...attemptRef.current, phase: "unknown", message: unknownMessage });
    writing.current = false;
    return () => {
      active.current = false;
      epoch.current += 1;
      readGeneration.current += 1;
      submissionGeneration.current += 1;
      reading.current?.abort();
      reading.current = null;
    };
  }, [updateAttempt]);

  const startRead = useCallback(() => {
    if (!active.current || reading.current || writing.current) return;
    const reference = RunTaskReference.safeParse({ runId });
    if (!reference.success) return;
    const controller = new AbortController();
    const requestEpoch = epoch.current;
    const generation = ++readGeneration.current;
    reading.current = controller;
    const finish = (next: ReadState) => {
      if (!active.current || controller.signal.aborted || epoch.current !== requestEpoch || generation !== readGeneration.current || reading.current !== controller) return;
      reading.current = null;
      updateRead(next);
    };
    void (async () => {
      try {
        const response = await fetch('/api/runs/' + reference.data.runId + '/delivery', { method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal });
        if (!response.ok) return finish({ kind: "unreadable" });
        const result = RunDeliveryResult.safeParse(await response.json());
        finish(result.success && result.data.ok && result.data.runId === reference.data.runId
          ? { kind: "ready", delivery: result.data.delivery, generation } : { kind: "unreadable" });
      } catch { finish({ kind: "unreadable" }); }
    })();
  }, [runId, updateRead]);

  const read = useCallback(() => {
    if (!active.current || reading.current || writing.current) return;
    candidateRef.current = null;
    setCandidate(null);
    setRecheckOpen(false);
    if (!RunTaskReference.safeParse({ runId }).success) { updateRead({ kind: "unreadable" }); return; }
    updateRead({ kind: "loading" });
    startRead();
  }, [runId, startRead, updateRead]);

  useEffect(() => { startRead(); }, [startRead]);
  useEffect(() => {
    const locked = () => candidateRef.current !== null || writing.current || attemptRef.current?.phase === "unknown";
    const warn = (event: BeforeUnloadEvent) => {
      if (!locked()) return;
      event.preventDefault(); event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (!locked() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const target = new URL(anchor.href, window.location.href);
      if (!["http:", "https:"].includes(target.protocol) || target.origin === window.location.origin && target.pathname + target.search === window.location.pathname + window.location.search) return;
      if (!window.confirm(leaveMessage)) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", click, true); };
  }, []);

  function prepare(event: FormEvent) {
    event.preventDefault();
    const current = readRef.current;
    if (!active.current || writing.current || reading.current || attemptRef.current || candidateRef.current || current.kind !== "ready" || current.delivery?.status !== "failed") return;
    let requestId: string;
    try { requestId = globalThis.crypto.randomUUID(); }
    catch { setError("当前浏览器无法生成安全的补投请求，请在安全连接中重新打开后核对。"); return; }
    const parsed = RunDeliveryRetryBody.safeParse({ requestId, confirmed: true, reason });
    if (!parsed.success) { setError("请填写补投核对原因，最多 500 字。"); return; }
    const next = { deliveryId: current.delivery.id, sourceUpdatedAt: current.delivery.updatedAt, payload: parsed.data, epoch: epoch.current };
    candidateRef.current = next; setCandidate(next); setError("");
  }

  async function submit(recheck = false) {
    if (!active.current || writing.current || reading.current) return;
    const selected = recheck ? attemptRef.current : candidateRef.current;
    const current = readRef.current;
    if (!selected || current.kind !== "ready" || !current.delivery || current.delivery.id !== selected.deliveryId
      || recheck && (attemptRef.current?.phase !== "unknown" || current.generation <= attemptRef.current.readGeneration)
      || !recheck && (current.delivery.status !== "failed" || candidateRef.current?.epoch !== epoch.current || current.delivery.updatedAt !== selected.sourceUpdatedAt)) return;
    const fixed: Attempt = { deliveryId: selected.deliveryId, sourceUpdatedAt: selected.sourceUpdatedAt, readGeneration: current.generation, payload: selected.payload, phase: "sending", message: "正在提交补投确认，请保留当前页面。" };
    const requestEpoch = epoch.current;
    const generation = ++submissionGeneration.current;
    writing.current = true;
    candidateRef.current = null; setCandidate(null); setRecheckOpen(false); setError(""); updateAttempt(fixed);
    const owns = () => active.current && epoch.current === requestEpoch && submissionGeneration.current === generation && attemptRef.current === fixed;
    const finish = (phase: Attempt["phase"], message: string) => {
      if (!owns()) return;
      writing.current = false;
      updateAttempt({ ...fixed, phase, message });
    };
    try {
      const response = await fetch('/api/runs/' + runId + '/delivery', { method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify(fixed.payload) });
      const parsed = RunDeliveryRetryResult.safeParse(await response.json());
      if (!parsed.success || response.status >= 500) return finish("unknown", unknownMessage);
      const result = parsed.data;
      if (response.ok && result.ok && result.runId === runId && result.deliveryId === fixed.deliveryId) {
        finish("recorded", "补投请求已记录；请重新读取投递状态。这里只确认请求已保存，不代表当前发送或接收状态。");
      } else if (recheck && !result.ok) {
        finish("unknown", unknownMessage + "本次核对未获准。" + safeReason(result.error));
      } else if (!response.ok && !result.ok && !result.retryable && response.status >= 400 && response.status < 500) {
        finish("rejected", "本次补投未获准。" + safeReason(result.error));
      } else finish("unknown", unknownMessage);
    } catch { finish("unknown", unknownMessage); }
  }

  function resumeEditing(phase: "recorded" | "rejected") {
    const previous = attemptRef.current;
    const current = readRef.current;
    if (!active.current || writing.current || reading.current || previous?.phase !== phase || current.kind !== "ready" || !current.delivery
      || current.delivery.id !== previous.deliveryId || current.delivery.status !== "failed"
      || phase === "recorded" && !newFailureFor(current, previous)) return;
    updateAttempt(null); setReason(""); setError("");
  }

  const delivery = readState.kind === "ready" ? readState.delivery : null;
  const locked = candidate !== null || attempt?.phase === "sending" || attempt?.phase === "unknown";
  const canRecheck = attempt?.phase === "unknown" && delivery !== null && delivery.id === attempt.deliveryId && readState.kind === "ready" && readState.generation > attempt.readGeneration;
  const canStartNew = attempt?.phase === "recorded" && newFailureFor(readState, attempt);

  return <section id="delivery" aria-labelledby="run-delivery-title" aria-busy={readState.kind === "loading" || attempt?.phase === "sending"} className="content-card scroll-mt-32">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="eyebrow">成果投递</p><h2 id="run-delivery-title" className="section-title mt-1">接收状态与人工补投</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">运行完成和成果送达分别核对。这里只展示已保存的投递记录，不新建接收方或自动补投。</p></div>
      <button type="button" onClick={read} disabled={readState.kind === "loading" || attempt?.phase === "sending"} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">重新读取投递状态</button>
    </div>
    {readState.kind === "loading" ? <p role="status" className="mt-4 text-sm text-slate-500">正在读取已保存的投递记录…</p> : readState.kind === "unreadable" ? <div role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"><p className="font-semibold">投递状态暂时无法核对</p><p>这不是无记录或发送失败的结论。可重新读取；运行结果和其他证据仍可查看。</p></div> : delivery === null ? <p role="status" className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">尚无已保存的投递记录。不能据此判断是否配置了接收方，或接收方是否已收到成果。</p> : <>
      <div className={'mt-4 rounded-xl p-4 ' + (delivery.status === "delivered" ? "bg-emerald-50" : delivery.status === "failed" ? "bg-amber-50" : "bg-slate-50")}>
        <h3 className="text-sm font-bold text-slate-900">{labels[delivery.status]}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">这是上次读取的保存快照；重新读取只查看记录，不会安排发送。</p>
        <dl className="mt-3 grid gap-3 text-sm lg:grid-cols-2">
          <div><dt className="text-xs text-slate-500">已尝试／当前次数上限</dt><dd className="mt-1 font-semibold text-slate-800">{delivery.attempts}／{delivery.maxAttempts} 次</dd></div>
          <div><dt className="text-xs text-slate-500">最后更新</dt><dd className="mt-1 text-slate-700">{timeLabel(delivery.updatedAt)}</dd></div>
          <div><dt className="text-xs text-slate-500">下次安排时间</dt><dd className="mt-1 text-slate-700">{timeLabel(delivery.nextAttemptAt)}</dd></div>
          <div><dt className="text-xs text-slate-500">接收确认时间</dt><dd className="mt-1 text-slate-700">{timeLabel(delivery.deliveredAt)}</dd></div>
          <div><dt className="text-xs text-slate-500">接收方防重有效期</dt><dd className="mt-1 text-slate-700">{timeLabel(delivery.retryDeadline)}</dd></div>
          <div><dt className="text-xs text-slate-500">已保存的人工补投</dt><dd className="mt-1 text-slate-700">{delivery.resolutions.length} 次</dd></div>
        </dl>
        {delivery.error ? <p className="mt-3 text-sm leading-6 text-amber-900">已保存原因：{safeReason(delivery.error)}</p> : null}
        {delivery.status === "delivered" ? <p className="mt-3 text-xs leading-5 text-emerald-800">已保存接收方对这次投递的有效确认回执；这不代表业务内容已获人工验收。</p> : null}
      </div>
      {delivery.status === "failed" && !attempt ? <form onSubmit={prepare} className="mt-5 space-y-3 rounded-xl border border-amber-200 p-4">
        <h3 className="text-sm font-bold text-slate-900">核对后申请补投</h3>
        <p className="text-xs leading-5 text-slate-600">先查询接收方记录，避免重复处理。提交后服务端仍会核对成果完整性、人工补投次数、防重期限和接收方配置，不保证允许补投。</p>
        <label className="grid gap-2 text-sm font-semibold text-slate-700">补投核对原因<textarea value={reason} onChange={(event) => { if (!candidateRef.current && !writing.current && !attemptRef.current) setReason(event.target.value); }} readOnly={locked} maxLength={500} rows={3} placeholder="说明查询时间、接收方查询结果及申请补投的依据；不要填写密钥或连接串。" className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
        <button ref={submitButton} type="submit" disabled={candidate !== null} className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">核对并申请补投</button>
      </form> : null}
    </>}
    {attempt ? <div className="mt-4 space-y-3">
      <p role={attempt.phase === "unknown" || attempt.phase === "rejected" ? "alert" : "status"} className={'rounded-xl p-4 text-sm leading-6 ' + (attempt.phase === "recorded" ? "bg-indigo-50 text-indigo-900" : "bg-amber-50 text-amber-900")}>{attempt.message}</p>
      <label className="grid gap-2 text-sm font-semibold text-slate-700">本次固定的补投原因<textarea readOnly value={attempt.payload.reason} rows={3} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-normal" /></label>
      {attempt.phase === "unknown" ? <><button ref={recheckButton} type="button" disabled={!canRecheck} onClick={() => setRecheckOpen(true)} className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50">按原请求核对补投</button><p className="text-xs leading-5 text-slate-600">须先读到原投递记录才能核对原请求。新的状态读取不会解锁原原因，也不证明上次提交失败；核对将再次提交同一份确认，不创建新请求。</p></> : null}
      {attempt.phase === "rejected" ? <button type="button" disabled={readState.kind !== "ready" || delivery === null || delivery.id !== attempt.deliveryId || delivery.status !== "failed"} onClick={() => resumeEditing("rejected")} className="text-sm font-semibold text-indigo-700 underline">重新填写补投原因</button> : null}
      {canStartNew ? <button type="button" onClick={() => resumeEditing("recorded")} className="text-sm font-semibold text-indigo-700 underline">针对新读取的失败记录重新申请</button> : null}
      {attempt.phase === "unknown" || attempt.phase === "sending" ? <p className="text-xs leading-5 text-amber-800">请保留本页。浏览器返回等离开方式不一定能拦截；关闭或离开不能取消服务端投递，重新打开后必须先核对保存记录。</p> : null}
    </div> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    <ConfirmDialog open={candidate !== null} onOpenChange={(open) => { if (!open && !writing.current) { candidateRef.current = null; setCandidate(null); } }} title="确认申请补投？" description="请确认已查询接收方记录并填写核对原因。系统只登记补投请求，仍会检查是否允许再次发送；不是接收方已收到成果的确认。" confirmLabel="确认申请补投" tone="warning" pending={attempt?.phase === "sending"} returnFocusRef={submitButton} onConfirm={() => { void submit(); }} />
    <ConfirmDialog open={recheckOpen} onOpenChange={setRecheckOpen} title="按原请求核对上次补投？" description="上次补投可能已经生效。继续会沿用原请求和原原因再次提交确认，服务端会防止同一请求重复登记；不会创建新请求，也不代表成果已送达。" confirmLabel="确认按原请求核对" tone="warning" pending={attempt?.phase === "sending"} returnFocusRef={recheckButton} onConfirm={() => { void submit(true); }} />
  </section>;
}

export function RunDeliveryPanel({ runId }: { runId: string }) {
  const reference = RunTaskReference.safeParse({ runId });
  const normalized = reference.success ? reference.data.runId : runId;
  return <RunDeliverySession key={normalized} runId={normalized} />;
}
