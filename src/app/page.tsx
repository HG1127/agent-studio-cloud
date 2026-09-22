import Link from "next/link";
import { HealthCard } from "@/features/dashboard/health-card";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold">Agent Studio</h1>
      <p className="text-gray-500">AI 助手工作台正在搭建，当前为脚手架版本。</p>
      <Link
        href="/agents"
        className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
      >
        进入工作台
      </Link>
      <HealthCard />
    </main>
  );
}
