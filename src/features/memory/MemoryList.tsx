"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { MemoryView } from "@/contracts/memory";
import { setMemoryArchivedAction } from "@/server/actions/archive-memory";

export function MemoryList({ memories, archived = false }: { memories: MemoryView[]; archived?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (memories.length === 0) {
    return <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
      {archived ? "没有已停用的经验" : "还没有长期经验。流程运行到“保存经验”步骤后会出现在这里。"}
    </p>;
  }
  return <>
    <ul className="space-y-3">
      {memories.map((memory) => (
        <li key={memory.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-gray-900">{memory.agentName}</p>
              <p className="mt-1 text-xs text-gray-500">由「{memory.sourceNodeTitle}」保存 · {memory.createdAt.slice(0, 10)}</p>
            </div>
            <span className="flex items-center gap-3">
              <Link href={`/runs/${memory.sourceRunId}`} className="text-xs text-blue-700 hover:underline">查看来源运行</Link>
              <button type="button" disabled={pending} className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50"
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    try {
                      const result = await setMemoryArchivedAction({ memoryId: memory.id, archived: !archived });
                      if (result.ok) router.refresh();
                      else setError(result.error);
                    } catch {
                      setError(archived ? "恢复经验失败，请检查网络后重试" : "停用经验失败，请检查网络后重试");
                    }
                  });
                }}>{archived ? "恢复" : "停用"}</button>
            </span>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-gray-600">查看经验内容</summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-3 text-xs text-gray-700">{memory.content}</pre>
          </details>
        </li>
      ))}
    </ul>
    {error ? <p role="alert" className="mt-3 text-sm text-red-600">{error}</p> : null}
  </>;
}
