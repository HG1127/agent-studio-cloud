"use client";

import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function SchedulesError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="page-shell">
      <section role="alert" className="content-card flex min-h-72 flex-col items-center justify-center text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-red-50 text-red-700"><AlertTriangle className="size-6" /></span>
        <h1 className="mt-4 text-xl font-bold text-slate-950">暂时无法读取定时任务</h1>
        <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">这次失败只影响任务列表读取，不会暂停、恢复或重复执行任何任务。</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={retry} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"><RotateCcw className="size-4" />重新读取</button>
          <Link href="/runs?source=schedule" className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">查看自动运行记录</Link>
        </div>
      </section>
    </main>
  );
}
