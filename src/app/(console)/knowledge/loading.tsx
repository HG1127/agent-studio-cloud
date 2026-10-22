import { Skeleton } from "@/components/ui/skeleton";

export default function KnowledgeLoading() {
  return <main className="page-shell" aria-busy="true" aria-label="正在读取业务资料">
    <div className="border-b border-slate-200 pb-5"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-9 w-40" /><Skeleton className="mt-3 h-5 w-full max-w-xl" /></div>
    <section className="content-card"><Skeleton className="h-6 w-28" /><Skeleton className="mt-4 h-10 w-full max-w-md" /></section>
    <section className="content-card"><Skeleton className="h-6 w-32" /><Skeleton className="mt-4 h-10 w-full max-w-xl" /></section>
    <section className="content-card"><Skeleton className="h-6 w-28" /><div className="mt-4 space-y-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}</div></section>
  </main>;
}
