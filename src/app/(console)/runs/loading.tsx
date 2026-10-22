import { LoaderCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function RunsLoading() {
  return (
    <main aria-live="polite" aria-busy="true" className="page-shell">
      <div className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><LoaderCircle aria-hidden="true" className="size-5 animate-spin" /></span>
        <div><p className="text-sm font-semibold text-slate-900">正在读取运行记录</p><p className="mt-1 text-xs leading-5 text-slate-500">系统正在整理任务状态和筛选范围，不会启动或改变任何运行。</p></div>
      </div>
      <div className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-9 w-52" /><Skeleton className="h-4 w-full max-w-xl" /></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-[74px] rounded-2xl" />)}</div>
      <Skeleton className="h-48 rounded-2xl" />
      <Skeleton className="h-96 rounded-2xl" />
    </main>
  );
}
