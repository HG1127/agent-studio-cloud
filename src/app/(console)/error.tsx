"use client";

import Link from "next/link";

export default function ConsoleError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center px-4 py-12 sm:px-8">
    <section role="alert" className="w-full rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-gray-900">页面暂时无法打开</h1>
      <p className="mt-2 text-sm text-gray-600">可能是网络或服务暂时不可用。你可以重试，已经保存的数据不会受到影响。</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={props.retry} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">重新加载</button>
        <Link href="/" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">返回工作台</Link>
      </div>
    </section>
  </main>;
}
