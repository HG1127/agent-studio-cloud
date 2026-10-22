import { Skeleton } from "@/components/ui/skeleton";

export default function VersionCompareLoading() {
  return <main className="page-shell max-w-6xl" aria-busy="true">
    <p role="status" className="text-sm text-slate-600">正在读取两份已保存版本，尚未计算变化或确认资源范围…</p>
    <Skeleton className="h-12 w-72 max-w-full" />
    <Skeleton className="h-24 w-full" />
    <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map((key) => <div key={key} className="content-card space-y-4"><Skeleton className="h-6 w-40" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>)}</div>
  </main>;
}
