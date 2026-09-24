import Link from "next/link";

const NAV_ITEMS = [
  { href: "/", label: "总览" },
  { href: "/agents", label: "助手" },
  { href: "/knowledge", label: "知识库" },
  { href: "/memory", label: "经验库" },
  { href: "/settings", label: "模型连接" },
  { href: "/schedules", label: "定时任务" },
  { href: "/runs", label: "运行记录" },
  { href: "/activity", label: "操作记录" },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <nav className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-8">
          <Link href="/" className="whitespace-nowrap text-sm font-semibold text-gray-900">Agent Studio</Link>
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="whitespace-nowrap text-sm text-gray-600 hover:text-gray-900">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}
