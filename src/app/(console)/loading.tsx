export default function ConsoleLoading() {
  return <main aria-live="polite" aria-busy="true" className="mx-auto w-full max-w-4xl p-8">
    <p className="text-sm text-gray-500">正在读取最新数据…</p>
    <div className="mt-5 space-y-3" aria-hidden="true">
      <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
      <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
      <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
    </div>
  </main>;
}
