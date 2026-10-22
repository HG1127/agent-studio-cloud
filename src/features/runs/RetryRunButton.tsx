"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { retryRunAction } from "@/server/actions/retry-run";

export function RetryRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const retryingRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);

  async function retry() {
    if (retryingRef.current) return;
    retryingRef.current = true;
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    setPending(true);
    setError(null);
    try {
      const result = await retryRunAction(runId, requestId);
      requestIdRef.current = null;
      if (result.ok) router.push(`/runs/${result.runId}`);
      else {
        setError(result.error);
        setConfirmOpen(false);
      }
    } catch {
      setError("再次运行失败，请稍后重试");
      setConfirmOpen(false);
    } finally {
      retryingRef.current = false;
      setPending(false);
    }
  }

  return <div className="flex flex-col items-start gap-1">
    <button type="button" disabled={pending} onClick={() => setConfirmOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50">
      <RotateCcw aria-hidden="true" className="size-4" />{pending ? "正在创建新运行…" : "按原输入再次运行"}
    </button>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title="按原输入创建一次新运行？"
      description="系统会使用这次运行冻结的版本和原始输入创建一条新记录；当前记录与证据不会被修改。新运行可能再次触发模型调用、工具操作或人工确认。"
      confirmLabel="创建新运行"
      tone="warning"
      pending={pending}
      onConfirm={() => { void retry(); }}
    />
  </div>;
}
