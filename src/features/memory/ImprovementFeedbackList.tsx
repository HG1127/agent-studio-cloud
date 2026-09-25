"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RunImprovementFeedbackView } from "@/contracts/run-feedback";
import { createRegressionCaseFromRunFeedbackAction } from "@/server/actions/run-feedback";

export function ImprovementFeedbackList({ feedback }: { feedback: RunImprovementFeedbackView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (feedback.length === 0) {
    return <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">没有符合条件的待改进结果</p>;
  }
  return <>
    <ul className="space-y-3">
      {feedback.map((item) => (
        <li key={item.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-gray-900">{item.agentName}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">{item.note}</p>
              <p className="mt-2 text-xs text-gray-500">更新于 {item.updatedAt.slice(0, 10)}</p>
            </div>
            <span className="flex shrink-0 items-center gap-3">
              <Link href={`/runs/${item.runId}`} className="text-xs text-blue-700 hover:underline">查看来源运行</Link>
              {item.evaluationCaseId ? (
                <Link href={`/agents/${item.agentId}`} className="text-xs text-emerald-700 hover:underline">已加入验收</Link>
              ) : (
                <button type="button" disabled={pending} className="text-xs text-amber-800 hover:underline disabled:text-gray-400"
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      try {
                        const result = await createRegressionCaseFromRunFeedbackAction(item.runId);
                        if (result.ok) router.refresh();
                        else setError(result.error);
                      } catch {
                        setError("加入验收样例失败，请稍后重试");
                      }
                    });
                  }}>加入验收样例</button>
              )}
            </span>
          </div>
        </li>
      ))}
    </ul>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
  </>;
}
