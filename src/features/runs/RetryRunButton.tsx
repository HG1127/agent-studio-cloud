"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { retryRunAction } from "@/server/actions/retry-run";

export function RetryRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return <div className="flex flex-col items-start gap-1">
    <button type="button" disabled={pending} onClick={async () => {
      setPending(true);
      setError(null);
      try {
        const result = await retryRunAction(runId);
        if (result.ok) router.push(`/runs/${result.runId}`);
        else setError(result.error);
      } catch {
        setError("再次运行失败，请稍后重试");
      } finally {
        setPending(false);
      }
    }} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-500 disabled:opacity-50">
      {pending ? "正在启动…" : "按原输入再次运行"}
    </button>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
  </div>;
}
