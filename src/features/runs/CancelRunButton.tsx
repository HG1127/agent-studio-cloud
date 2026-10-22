"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelRunAction } from "@/server/actions/cancel-run";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function CancelRunButton({ runId, cancelsChain = false }: { runId: string; cancelsChain?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function cancel() {
    setPending(true);
    setError(null);
    try {
      const result = await cancelRunAction(runId);
      if (result.ok) {
        setConfirmOpen(false);
        router.refresh();
      }
      else {
        setConfirmOpen(false);
        setError(result.error);
      }
    } catch {
      setConfirmOpen(false);
      setError("取消失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" disabled={pending} onClick={() => setConfirmOpen(true)}
        className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:border-red-400 disabled:text-gray-400">
        {pending ? "正在取消…" : "取消运行"}
      </button>
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={cancelsChain ? "停止整条协作任务？" : "取消这次运行？"}
        description={cancelsChain
          ? "这是协作或交接子任务。取消后会同时停止上级任务和同一执行链中的其他子任务；已经完成的外部操作不会自动撤销。"
          : "运行会停止，已经完成的外部操作不会自动撤销；当前处理记录仍会保留。"}
        confirmLabel={cancelsChain ? "确认停止整条任务" : "确认取消"} onConfirm={() => void cancel()} pending={pending} />
    </div>
  );
}
