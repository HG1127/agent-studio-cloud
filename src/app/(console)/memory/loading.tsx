import { Skeleton } from "@/components/ui/skeleton";

export default function MemoryLoading() {
  return <main className="page-shell" aria-busy="true" aria-label="正在读取成长中心">
    <div className="border-b border-slate-200 pb-5"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-9 w-36" /><Skeleton className="mt-3 h-5 w-full max-w-xl" /></div>
    <section className="content-card"><Skeleton className="h-10 w-full" /></section>
    <section className="content-card"><Skeleton className="h-6 w-32" /><div className="mt-4 space-y-3">{Array.from({ length: 2 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)}</div></section>
    <section className="content-card"><Skeleton className="h-6 w-32" /><div className="mt-4 space-y-3">{Array.from({ length: 2 }, (_, index) => <Skeleton key={index} className="h-36 rounded-xl" />)}</div></section>
  </main>;
}
