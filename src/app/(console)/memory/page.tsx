import Link from "next/link";
import { MemoryList } from "@/features/memory/MemoryList";
import { listMemories, listMemoryAgentOptions } from "@/server/queries/memory";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MemoryPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const agentId = one(params.agent);
  const query = one(params.q)?.trim().slice(0, 200);
  const [memories, archivedMemories, agents] = await Promise.all([
    listMemories({ agentId, query }),
    listMemories({ archived: true }),
    listMemoryAgentOptions(),
  ]);
  const filtered = Boolean(agentId || query);
  return <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
    <header>
      <h1 className="text-2xl font-bold">经验库</h1>
      <p className="mt-1 text-sm text-gray-500">查看助手在运行中明确保存的长期经验，并停用不再适用的内容。</p>
    </header>
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-gray-600">助手
        <select name="agent" defaultValue={agentId ?? ""} className="rounded-md border border-gray-300 px-2 py-2 text-sm">
          <option value="">全部助手</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
      </label>
      <label className="flex min-w-56 flex-[2] flex-col gap-1 text-xs text-gray-600">内容关键词
        <input name="q" defaultValue={query ?? ""} maxLength={200} className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
      </label>
      <button type="submit" className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white">筛选</button>
      {filtered ? <Link href="/memory" className="px-1 py-2 text-sm text-gray-500 hover:text-gray-800">清除筛选</Link> : null}
    </form>
    <MemoryList memories={memories} />
    {archivedMemories.length > 0 ? <section className="border-t border-gray-200 pt-6">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">已停用经验</h2>
      <MemoryList memories={archivedMemories} archived />
    </section> : null}
  </main>;
}
