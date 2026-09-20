import { HealthCard } from "@/features/dashboard/health-card";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold">Agent Studio</h1>
      <p className="text-gray-500">AI 助手工作台正在搭建，当前为脚手架版本。</p>
      <HealthCard />
    </main>
  );
}
