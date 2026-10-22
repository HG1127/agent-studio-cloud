import { Skeleton } from "@/components/ui/skeleton";

export default function SchedulesLoading() {
  return <main className="page-shell" aria-busy="true" aria-label="正在读取定时任务"><div className="border-b border-slate-200 pb-5"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-9 w-36" /><Skeleton className="mt-3 h-5 w-full max-w-xl" /></div><section className="content-card"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}</div><Skeleton className="mt-5 h-11 w-64" /><div className="mt-5 space-y-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-40 rounded-2xl" />)}</div></section></main>;
}
