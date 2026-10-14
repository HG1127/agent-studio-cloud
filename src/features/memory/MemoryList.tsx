"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, BookOpenText, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { MemoryView } from "@/contracts/memory";
import { setMemoryArchivedAction } from "@/server/actions/archive-memory";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { memoryPreview } from "@/features/memory/memory-preview";

export function MemoryList({ memories, archived = false, filtered = false }: { memories: MemoryView[]; archived?: boolean; filtered?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmMemory, setConfirmMemory] = useState<MemoryView | null>(null);
  if (memories.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-7 text-center"><BookOpenText className="mx-auto size-7 text-slate-400" /><p className="mt-3 text-sm font-medium text-slate-600">{filtered ? "没有符合筛选条件的经验" : archived ? "没有已停用的经验" : "还没有长期经验"}</p>{filtered || archived ? null : <p className="mt-1 text-xs text-slate-500">流程运行到“保存经验”步骤后会出现在这里。</p>}</div>;
  }
  return <>
    <ul className="space-y-3">
      {memories.map((memory) => (
        <li key={memory.id} className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><BookOpenText className="size-5" /></span>
              <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{memory.agentName}</p>
              <p className="mt-1 text-xs text-slate-500">由「{memory.sourceNodeTitle}」保存 · {memory.createdAt.slice(0, 10)}</p></div>
            </div>
            <span className="flex flex-wrap items-center gap-3">
              <Link href={`/runs/${memory.sourceRunId}`} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900">查看来源运行<ExternalLink className="size-3" /></Link>
              <button type="button" disabled={pending} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50"
                onClick={() => { setError(null); setConfirmMemory(memory); }}>{archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}{archived ? "恢复" : "停用"}</button>
            </span>
          </div>
          <p className="mt-4 line-clamp-3 break-words text-sm leading-6 text-slate-700">{memoryPreview(memory.content)}</p>
          <details className="mt-4 border-t border-slate-100 pt-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-indigo-700">查看完整保存内容</summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-700">{memory.content}</pre>
          </details>
        </li>
      ))}
    </ul>
    {error ? <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
    <ConfirmDialog
      open={confirmMemory !== null}
      onOpenChange={(open) => { if (!open) setConfirmMemory(null); }}
      title={archived ? "恢复这条经验？" : "停用这条经验？"}
      description={archived
        ? `“${confirmMemory?.agentName ?? "这位助手"}”的这条经验恢复后，可再次被后续运行检索。`
        : `“${confirmMemory?.agentName ?? "这位助手"}”的这条经验停用后不再参与后续检索，来源运行记录仍会保留，之后可以恢复。`}
      confirmLabel={archived ? "确认恢复" : "确认停用"}
      tone="warning"
      pending={pending}
      onConfirm={() => {
        const memory = confirmMemory;
        if (!memory) return;
        setError(null);
        startTransition(async () => {
          try {
            const result = await setMemoryArchivedAction({ memoryId: memory.id, archived: !archived });
            if (result.ok) router.refresh();
            else setError(result.error);
          } catch {
            setError(archived ? "恢复经验失败，请检查网络后重试" : "停用经验失败，请检查网络后重试");
          } finally {
            setConfirmMemory(null);
          }
        });
      }}
    />
  </>;
}

export function MemoryPagination({ page, hasNext, previousHref, nextHref, label }: {
  page: number;
  hasNext: boolean;
  previousHref: string;
  nextHref: string;
  label: string;
}) {
  if (page === 1 && !hasNext) return null;
  return <nav aria-label={label} className="flex items-center justify-between gap-3 text-sm">
    {page > 1
      ? <Link href={previousHref} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 hover:border-indigo-200 hover:text-indigo-700"><ChevronLeft className="size-4" />上一页</Link>
      : <span />}
    <span className="text-gray-500">第 {page} 页</span>
    {hasNext
      ? <Link href={nextHref} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 hover:border-indigo-200 hover:text-indigo-700">下一页<ChevronRight className="size-4" /></Link>
      : <span />}
  </nav>;
}
