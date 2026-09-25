"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resumeRunStartAction } from "@/server/actions/resume-run-start";

export function ResumeRunStartButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return <div className="flex flex-col items-start gap-1">
    <button type="button" disabled={pending} onClick={async () => {
      setPending(true);
      setError(null);
      try {
        const result = await resumeRunStartAction(runId);
        if (result.ok) router.refresh();
        else setError(result.error);
      } catch {
        setError("继续启动失败，请稍后重试");
      } finally {
        setPending(false);
      }
    }} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 hover:border-amber-500 disabled:opacity-50">
      {pending ? "正在继续…" : "继续启动"}
    </button>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
  </div>;
}
