"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { PageRefreshButton } from "./PageRefreshButton";
import { Skeleton } from "./skeleton";
import { cn } from "@/lib/utils";

export function SectionLoadingState({ id, title, description, className, delayMs = 10_000 }: {
  id: string; title: string; description: string; className?: string; delayMs?: number;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  return <section id={id} aria-labelledby={`${id}-loading-title`} aria-busy="true" className={cn("content-card scroll-mt-32 min-h-48 space-y-4", className)}>
    <div className="flex items-start gap-3"><LoaderCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-indigo-600 motion-safe:animate-spin" /><div><h2 id={`${id}-loading-title`} className="section-title">{title}</h2><p role="status" className="mt-2 text-sm leading-6 text-slate-500">{description}</p></div></div>
    <div aria-hidden className="space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-12 w-full" /><Skeleton className="h-4 w-1/2" /></div>
    {slow ? <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="max-w-xl text-xs leading-5 text-amber-950">此分区读取较慢，可继续等待或重新读取。其他已读取内容仍可使用；重新读取不会保存草稿、发布版本或启动运行。</p><PageRefreshButton /></div> : null}
  </section>;
}
