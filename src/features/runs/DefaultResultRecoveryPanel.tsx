"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DefaultResultDeliveryInput, DefaultResultDeliveryQueryResult, RecoverDefaultResultBody, RecoverDefaultResultResult,
  type DefaultResultDeliveryView,
} from "@/contracts/default-result-delivery";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Attempt = { runId: string; body: RecoverDefaultResultBody; sourceUpdatedAt: string; sequence: number };
type Candidate = { updatedAt: string; generation: number };
const UNKNOWN = "本次提交尚不能确认；请先核对，不要重复发送或重新运行任务。";
const PENDING = "成果状态已保留，但流程通知尚未确认。请稍后再次核对；不会重新发送成果或运行模型、工具。";
const LABELS: Record<DefaultResultDeliveryView["status"], string> = {
  ready: "已保存，可继续处理", sending: "正在发送或确认", waiting_review: "等待核对",
  confirmed: "执行系统已确认成果", failed: "成果确认已停止",
};

function mayVerify(delivery: DefaultResultDeliveryView | null, unresolved: boolean, readable: boolean): boolean {
  // 终态的 verify 只读回原成果；丢失回执时即使已无等待入口，也不能把用户锁在未知状态。
  return delivery !== null && (delivery.canVerify || unresolved && readable && !delivery.canRetry && ["confirmed", "failed"].includes(delivery.status));
}

async function responseData(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !response.body) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error("unreadable response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let bytes = 0; let text = "";
  try {
    if (signal.aborted) throw new Error("aborted response");
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw new Error("aborted response");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16 * 1024) throw new Error("oversized response");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

function RecoverySession({ runId }: { runId: string }) {
  const [delivery, setDelivery] = useState<DefaultResultDeliveryView | null>(null);
  const [readPhase, setReadPhase] = useState<"loading" | "ready" | "error">("loading");
  const [writing, setWriting] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [notificationPending, setNotificationPending] = useState(false);
  const [message, setMessage] = useState("");
  const [cooling, setCooling] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const active = useRef(false); const epoch = useRef(0); const sequence = useRef(0);
  const deliveryRef = useRef<DefaultResultDeliveryView | null>(null);
  const readPhaseRef = useRef(readPhase); const generation = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const uncertain = useRef<Attempt | null>(null);
  const candidateRef = useRef<Candidate | null>(null);
  const cooldownUntil = useRef(0);
  const timers = useRef(new Set<number>());
  const readButton = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const schedule = useCallback((operation: () => void, delay: number) => {
    const timer = window.setTimeout(() => { timers.current.delete(timer); operation(); }, delay);
    timers.current.add(timer); return timer;
  }, []);
  const clearTimer = useCallback((timer: number) => { window.clearTimeout(timer); timers.current.delete(timer); }, []);
  const updateDelivery = useCallback((next: DefaultResultDeliveryView | null) => { deliveryRef.current = next; setDelivery(next); }, []);
  const updateRead = useCallback((next: typeof readPhase) => { readPhaseRef.current = next; setReadPhase(next); }, []);

  useLayoutEffect(() => {
    active.current = true; epoch.current += 1;
    const ownedTimers = timers.current;
    return () => {
      active.current = false; epoch.current += 1;
      readRequest.current?.abort(); writeRequest.current?.abort();
      readRequest.current = null; writeRequest.current = null;
      ownedTimers.forEach((timer) => window.clearTimeout(timer)); ownedTimers.clear();
    };
  }, []);

  const read = useCallback(() => {
    if (!active.current || readRequest.current || writeRequest.current || candidateRef.current) return;
    const controller = new AbortController(); const owner = epoch.current;
    readRequest.current = controller; updateRead("loading");
    const current = () => active.current && epoch.current === owner && readRequest.current === controller && !controller.signal.aborted;
    const timeout = schedule(() => {
      if (!current()) return;
      readRequest.current = null; controller.abort(); updateRead("error");
    }, 30_000);
    void (async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/default-result`, { method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal });
        const parsed = DefaultResultDeliveryQueryResult.safeParse(await responseData(response, controller.signal));
        if (!current()) return;
        if (!parsed.success || (parsed.data.delivery === null ? response.status !== 404 : response.status !== 200 || parsed.data.delivery.runId !== runId)) {
          updateRead("error"); return;
        }
        generation.current += 1; updateDelivery(parsed.data.delivery); updateRead("ready");
      } catch { if (current()) updateRead("error"); }
      finally { clearTimer(timeout); if (readRequest.current === controller) readRequest.current = null; }
    })();
  }, [runId, schedule, clearTimer, updateDelivery, updateRead]);
  useEffect(() => { read(); return () => { readRequest.current?.abort(); }; }, [read]);
  useEffect(() => {
    const locked = () => writeRequest.current !== null || uncertain.current !== null || candidateRef.current !== null;
    const warn = (event: BeforeUnloadEvent) => { if (locked()) { event.preventDefault(); event.returnValue = ""; } };
    const navigate = (event: MouseEvent) => {
      if (!locked() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || anchor.target && anchor.target !== "_self") return;
      const target = new URL(anchor.href, window.location.href);
      if (!["http:", "https:"].includes(target.protocol) || target.origin === window.location.origin && target.pathname + target.search === window.location.pathname + window.location.search) return;
      if (!window.confirm("当前成果提交或核对尚未确认，离开会丢失本页提交线索，但不会取消后台处理。确定离开吗？")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate, true); };
  }, []);

  function closeCandidate() { candidateRef.current = null; setCandidate(null); }
  function requestRetry(target: HTMLButtonElement) {
    const latest = deliveryRef.current;
    if (!active.current || !latest?.canRetry || ["confirmed", "failed"].includes(latest.status) || uncertain.current || readPhaseRef.current !== "ready" || readRequest.current || writeRequest.current || cooldownUntil.current > Date.now()) return;
    const next = { updatedAt: latest.updatedAt, generation: generation.current };
    candidateRef.current = next; returnFocus.current = target; setCandidate(next);
  }
  async function submit(mode: RecoverDefaultResultBody["mode"]) {
    const latest = deliveryRef.current;
    if (!active.current || !latest || readRequest.current || writeRequest.current || cooldownUntil.current > Date.now()) return;
    if (mode === "verify" ? !mayVerify(latest, uncertain.current !== null, readPhaseRef.current === "ready") || candidateRef.current !== null
      : !latest.canRetry || ["confirmed", "failed"].includes(latest.status) || uncertain.current !== null || readPhaseRef.current !== "ready"
        || !candidateRef.current || candidateRef.current.updatedAt !== latest.updatedAt || candidateRef.current.generation !== generation.current) return;
    const body = RecoverDefaultResultBody.parse({ mode });
    const attempt: Attempt = { runId, body, sourceUpdatedAt: latest.updatedAt, sequence: ++sequence.current };
    const controller = new AbortController(); const owner = epoch.current;
    writeRequest.current = controller; setWriting(true); setMessage("");
    const current = () => active.current && epoch.current === owner && writeRequest.current === controller && !controller.signal.aborted;
    const markUnknown = () => { uncertain.current ??= attempt; setUnknown(true); setMessage(UNKNOWN); };
    const finish = () => { writeRequest.current = null; setWriting(false); returnFocus.current = readButton.current; closeCandidate(); };
    const timeout = schedule(() => {
      if (!current()) return;
      markUnknown(); finish(); controller.abort();
    }, 30_000);
    try {
      const response = await fetch(`/api/runs/${attempt.runId}/default-result`, { method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify(attempt.body), signal: controller.signal });
      const parsed = RecoverDefaultResultResult.safeParse(await responseData(response, controller.signal));
      if (!current()) return;
      if (!parsed.success || !parsed.data.ok || parsed.data.delivery.runId !== runId
        || (parsed.data.workflowNotificationPending ? response.status !== 202 : response.status !== 200)) { markUnknown(); return; }
      const result = parsed.data;
      uncertain.current = null; setUnknown(false);
      generation.current += 1; updateDelivery(result.delivery); updateRead("ready");
      setNotificationPending(Boolean(result.workflowNotificationPending));
      if (result.workflowNotificationPending) {
        setMessage(PENDING);
        const rawDelay = response.headers.get("retry-after") ?? "2";
        const seconds = /^\d{1,3}$/.test(rawDelay) ? Math.min(60, Math.max(2, Number(rawDelay))) : 2;
        cooldownUntil.current = Date.now() + seconds * 1000; setCooling(true);
        schedule(() => { if (active.current && epoch.current === owner) { cooldownUntil.current = 0; setCooling(false); } }, seconds * 1000);
      } else setMessage(result.workflowNotified ? "本次流程通知已提交；请结合任务状态核对是否结束，不代表业务验收通过。" : "本次成果状态已核对；请结合任务与执行证据确认，不代表业务验收通过。");
    } catch { if (current()) markUnknown(); }
    finally { clearTimer(timeout); if (active.current && epoch.current === owner && writeRequest.current === controller) finish(); }
  }

  const busy = writing || readPhase === "loading";
  const canRetry = delivery?.canRetry && !["confirmed", "failed"].includes(delivery.status) && readPhase === "ready" && !unknown && !notificationPending;
  return <section aria-label="主流程成果确认" className="content-card min-w-0 space-y-4">
    <div><h2 className="text-sm font-semibold">主流程成果确认</h2><p className="mt-2 text-xs leading-5 text-slate-500">核对执行系统是否收到已保存的成果，与外部接收方投递分别记录。这里不会重新运行模型或工具。</p></div>
    {readPhase === "loading" ? <p role="status" className="text-sm text-slate-600">正在读取成果确认记录…</p> : readPhase === "error" ? <p role="alert" className="text-sm leading-6 text-amber-900">成果确认记录暂时无法读取，状态未知；不会据此再次发送。可重新读取，或核对上次已读记录。</p> : !delivery ? <p className="text-sm leading-6 text-slate-600">当前没有读到可核对的主流程成果记录；旧任务或无需此确认的任务可能没有记录，不能据此判断成果丢失。</p> : null}
    {delivery ? <dl className="space-y-2 text-sm text-slate-700"><div><dt className="inline text-slate-500">{readPhase === "ready" ? "成果状态：" : "上次读取的成果状态："}</dt><dd className="inline">{LABELS[delivery.status]}</dd></div><div><dt className="inline text-slate-500">已记录发送次数：</dt><dd className="inline">{delivery.writeAttempts}</dd></div></dl> : null}
    {delivery?.status === "failed" ? <p className="text-xs leading-5 text-slate-500">这是成果确认状态，不会把任务本身改判为失败。</p> : null}
    {notificationPending ? <p role="status" className="text-sm leading-6 text-amber-900">{PENDING}</p> : message && !unknown ? <p role="status" className="text-sm leading-6 text-slate-700">{message}</p> : null}
    {unknown ? <p role="alert" className="text-sm leading-6 text-amber-900">{UNKNOWN}重新读取记录不能单独证明上次提交未处理。</p> : null}
    {writing || unknown || candidate ? <p className="text-xs leading-5 text-amber-900">请先完成本页核对。离开或刷新不会取消后台处理，本页提交线索也不会自动恢复；不要因此重新发送或重跑任务。</p> : null}
    {cooling ? <p className="text-xs text-slate-500">请按服务端建议稍等，再手动核对；页面不会自动提交。</p> : null}
    <div className="flex flex-wrap gap-2">
      <button ref={readButton} type="button" className={buttonVariants({ variant: "secondary" })} disabled={busy || candidate !== null} onClick={read}>重新读取成果记录</button>
      <Button type="button" variant="secondary" disabled={busy || cooling || !mayVerify(delivery, unknown, readPhase === "ready") || candidate !== null} onClick={() => { void submit("verify"); }}>核对成果与流程通知</Button>
      <Button type="button" disabled={busy || cooling || !canRetry || candidate !== null} onClick={(event) => requestRetry(event.currentTarget)}>继续发送已保存成果</Button>
    </div>
    <ConfirmDialog open={candidate !== null} onOpenChange={(open) => { if (!open && !writeRequest.current) closeCandidate(); }} title="确认继续处理已保存成果" description="只使用这次任务已经保存的成果，按服务端允许的状态继续发送或确认。不重新运行模型或工具；提交结果不明时必须先核对，不能重复发送。" confirmLabel="确认继续发送" onConfirm={() => { void submit("retry"); }} pending={writing} tone="warning" returnFocusRef={returnFocus} />
  </section>;
}

export function DefaultResultRecoveryPanel({ runId }: { runId: string }) {
  const parsed = DefaultResultDeliveryInput.safeParse({ runId });
  if (!parsed.success) return <p role="alert" className="text-sm text-amber-900">任务关联无法核对，未读取或发送成果。</p>;
  const reference = parsed.data.runId.toLowerCase();
  return <RecoverySession key={reference} runId={reference} />;
}
