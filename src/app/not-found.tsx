import Link from "next/link";

export default function NotFound() {
  return <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-8 py-12">
    <section className="w-full rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-gray-900">没有找到这个页面</h1>
      <p className="mt-2 text-sm text-gray-500">内容可能已停用、地址有误，或你打开的是旧链接。</p>
      <Link href="/" className="mt-5 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700">返回工作台</Link>
    </section>
  </main>;
}
