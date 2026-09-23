import Link from "next/link";

const NAV_ITEMS = [
  { href: "/agents", label: "助手" },
  { href: "/knowledge", label: "知识库" },
  { href: "/schedules", label: "定时任务" },
  { href: "/runs", label: "运行记录" },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <nav className="mx-auto flex w-full max-w-3xl items-center gap-6 px-8 py-3">
          <Link href="/agents" className="text-sm font-semibold text-gray-900">Agent Studio</Link>
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="text-sm text-gray-600 hover:text-gray-900">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}
