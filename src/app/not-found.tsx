import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center px-8 py-12">
      <section className="w-full rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-gray-500">页面不存在</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">没有找到你要查看的内容</h1>
        <p className="mt-2 text-sm text-gray-600">内容可能已被停用、归档，或链接已经失效。</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/" className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700">返回工作台</Link>
          <Link href="/agents" className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-500">查看助手</Link>
          <Link href="/runs" className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-500">查看运行记录</Link>
        </div>
      </section>
    </main>
  );
}
