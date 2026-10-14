"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function KnowledgeRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return <button type="button" disabled={pending} aria-busy={pending}
    onClick={() => startTransition(() => router.refresh())}
    className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400">
    <RefreshCw aria-hidden="true" className={`size-4 ${pending ? "motion-safe:animate-spin" : ""}`} />
    {pending ? "正在读取…" : "重新读取状态"}
  </button>;
}
