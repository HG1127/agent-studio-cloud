import { LoaderCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SlowLoadNotice } from "@/components/ui/SlowLoadNotice";

export function PageLoadState({ title, description, cards = 0, filters = false, rows = 3 }: {
  title: string;
  description: string;
  cards?: number;
  filters?: boolean;
  rows?: number;
}) {
  return <main aria-busy="true" aria-label={title} aria-live="polite" className="page-shell">
    <div role="status" className="flex max-w-2xl items-start gap-3 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><LoaderCircle aria-hidden="true" className="size-5 animate-spin" /></span>
      <div><p className="text-sm font-semibold text-slate-900">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>
    </div>
    <SlowLoadNotice />
    <div className="space-y-2" aria-hidden="true"><Skeleton className="h-3 w-20" /><Skeleton className="h-9 w-48" /><Skeleton className="h-4 w-full max-w-xl" /></div>
    {cards > 0 ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">{Array.from({ length: cards }, (_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}</div> : null}
    {filters ? <div className="content-card flex gap-3" aria-hidden="true"><Skeleton className="h-10 min-w-0 flex-1" /><Skeleton className="h-10 w-20 shrink-0" /></div> : null}
    <section className="content-card space-y-3" aria-hidden="true"><Skeleton className="h-6 w-36" />{Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-20 rounded-xl" />)}</section>
  </main>;
}
