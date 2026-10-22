"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { readSessionValue, removeSessionValue, writeSessionValue } from "@/lib/session-storage";
import { startEvaluationAction } from "@/server/actions/evaluations";
import { evaluationRequestRecoveryKey, PendingEvaluationRequest } from "@/features/quality/evaluation-request-recovery";

export function AcceptanceRunButton({ agentId, agentName, versionId, caseCount, candidate, running, previouslyEvaluated }: {
  agentId: string;
  agentName: string;
  versionId: string | null;
  caseCount: number;
  candidate: boolean;
  running: boolean;
  previouslyEvaluated: boolean;
}) {
  const router = useRouter();
  const recoveryKey = evaluationRequestRecoveryKey(agentId);
  const inFlight = useRef(false);
  const [recoveryLoaded, setRecoveryLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<PendingEvaluationRequest | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canStart = Boolean(recoveryLoaded && candidate && versionId && caseCount > 0 && !running && !pendingRequest);
  const canRetry = Boolean(pendingRequest && versionId === pendingRequest.versionId);

  useEffect(() => {
    const raw = readSessionValue(recoveryKey);
    if (!raw) {
      queueMicrotask(() => setRecoveryLoaded(true));
      return;
    }
    try {
      const parsed = PendingEvaluationRequest.parse(JSON.parse(raw));
      queueMicrotask(() => { setPendingRequest(parsed); setRecoveryLoaded(true); });
    } catch {
      removeSessionValue(recoveryKey);
      queueMicrotask(() => setRecoveryLoaded(true));
    }
  }, [recoveryKey]);

  async function runEvaluation() {
    if (inFlight.current || (!canStart && !canRetry) || !versionId) return;
    inFlight.current = true;
    setConfirmOpen(false);
    setPending(true);
    setError(null);
    setNotice(null);
    const request = pendingRequest ?? { requestId: crypto.randomUUID(), versionId };
    setStorageUnavailable(!writeSessionValue(recoveryKey, JSON.stringify(request)));
    try {
      const result = await startEvaluationAction(agentId, request.requestId);
      if (result.ok) {
        removeSessionValue(recoveryKey);
        setPendingRequest(null);
        setStorageUnavailable(false);
        setNotice("验收请求已处理。请查看最新验收记录和发布状态。");
      } else if (result.error === "启动自动验收失败，请稍后重试") {
        setPendingRequest(request);
        setError("暂时无法确认验收是否已启动。请核对记录；再次操作会沿用同一请求。");
      } else {
        removeSessionValue(recoveryKey);
        setPendingRequest(null);
        setStorageUnavailable(false);
        setError(result.error);
      }
      router.refresh();
    } catch {
      setPendingRequest(request);
      setError("暂时无法确认验收是否已启动。请核对记录；再次操作会沿用同一请求。");
      router.refresh();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (!recoveryLoaded || (!canStart && !pendingRequest && !pending && !error && !notice)) return null;

  return <div className="min-w-0">
    {(canStart || canRetry) ? <Button type="button" size="sm" disabled={pending} onClick={() => setConfirmOpen(true)}>
      <FlaskConical className="size-3.5" />{pending ? "正在验收…" : pendingRequest ? "核对上次验收" : previouslyEvaluated ? "重新验收" : "验收全部样例"}
    </Button> : null}
    {pendingRequest && !pending ? <div role="status" className="mt-2 max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
      <p className="font-semibold">上次验收结果待核对{versionId !== pendingRequest.versionId ? "，版本已变化" : ""}</p>
      <p>请先查看验收记录。{versionId !== pendingRequest.versionId ? "不要用旧请求启动当前版本的验收。" : "若需继续，可用原请求核对，不会重新创建同一轮。"}</p>
      {storageUnavailable ? <p>浏览器未能保留请求线索；请保持本页打开，先完成核对。</p> : null}
      <div className="mt-2 flex flex-wrap gap-3"><Link href={`/agents/${agentId}#evaluation`} className="font-semibold underline underline-offset-2">查看验收记录</Link><button type="button" onClick={() => router.refresh()} className="font-semibold underline underline-offset-2">重新读取状态</button><button type="button" onClick={() => setUnlockOpen(true)} className="font-semibold underline underline-offset-2">已核对，继续操作</button></div>
    </div> : null}
    {error ? <p role="alert" className="mt-2 max-w-lg rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="mt-2 max-w-lg rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">{notice}</p> : null}
    <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen}
      title={pendingRequest ? "核对上次验收请求？" : "运行全部验收样例？"}
      description={pendingRequest
        ? "将沿用上次相同的请求核对。如果上次已启动，不会新建另一轮；如果尚未启动，可能现在开始验收。"
        : `将运行「${agentName}」当前候选版本的 ${caseCount} 条已启用样例。若全部通过，候选版本可能自动上线；请先确认样例输入和检查条件。`}
      confirmLabel={pendingRequest ? "用原请求核对" : "确认验收"} tone="warning" pending={pending}
      onConfirm={() => { void runEvaluation(); }} />
    <ConfirmDialog open={unlockOpen} onOpenChange={setUnlockOpen}
      title="已经核对上次验收？"
      description="上次验收可能已经运行。只有确认验收记录与当前版本状态后，才应放弃原请求并允许新的验收。"
      confirmLabel="继续操作" tone="warning" onConfirm={() => {
        removeSessionValue(recoveryKey);
        setPendingRequest(null);
        setStorageUnavailable(false);
        setError(null);
        setUnlockOpen(false);
      }} />
  </div>;
}
