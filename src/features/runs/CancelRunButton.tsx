"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelRunAction } from "@/server/actions/cancel-run";

export function CancelRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm("确定取消这次运行吗？已经完成的外部操作不会自动撤销。")) return;
    setPending(true);
    setError(null);
    try {
      const result = await cancelRunAction(runId);
      if (result.ok) router.refresh();
      else setError(result.error);
    } catch {
      setError("取消失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" disabled={pending} onClick={cancel}
        className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:border-red-400 disabled:text-gray-400">
        {pending ? "正在取消…" : "取消运行"}
      </button>
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
