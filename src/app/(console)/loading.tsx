import { LoaderCircle } from "lucide-react";

export default function ConsoleLoading() {
  return <main aria-live="polite" aria-busy="true" className="page-shell">
    <div className="flex max-w-2xl items-start gap-3 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><LoaderCircle aria-hidden="true" className="size-5 animate-spin" /></span>
      <div><p className="text-sm font-semibold text-slate-900">正在读取工作区最新状态</p><p className="mt-1 text-xs leading-5 text-slate-500">首次连接可能需要一点时间；页面会在数据就绪后自动更新，已经保存的内容不会受到影响。</p></div>
    </div>
    <div className="space-y-3" aria-hidden="true"><div className="h-3 w-24 animate-pulse rounded bg-indigo-100" /><div className="h-9 w-48 animate-pulse rounded-lg bg-slate-200" /><div className="h-4 w-80 max-w-full animate-pulse rounded bg-slate-200" /></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
    <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" aria-hidden="true" />
  </main>;
}
