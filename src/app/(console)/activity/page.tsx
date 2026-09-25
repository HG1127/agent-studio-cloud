import Link from "next/link";
import { AuditEventFilters } from "@/contracts/audit-event";
import { AuditEventList, AuditEventPagination } from "@/features/activity/AuditEventList";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { firstSearchParam, pageFromSearchParam } from "@/lib/search-params";
import { listAuditEvents } from "@/server/queries/audit-events";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function ActivityPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsedFilters = AuditEventFilters.safeParse({
    targetType: firstSearchParam(params.type) || undefined,
    query: firstSearchParam(params.q)?.trim() || undefined,
  });
  const filters = parsedFilters.success ? parsedFilters.data : {};
  const page = pageFromSearchParam(params.page);
  const rows = await listAuditEvents(DEMO_WORKSPACE_ID, filters, {
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
  });
  const hasNext = rows.length > PAGE_SIZE;
  const filtered = Boolean(filters.targetType || filters.query);
  return <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
    <header>
      <h1 className="text-2xl font-bold">操作记录</h1>
      <p className="mt-1 text-sm text-gray-500">查看助手、流程、版本、知识资料、经验、运行反馈和自动验收的关键变更。</p>
    </header>
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-gray-600">记录类型
        <select name="type" defaultValue={filters.targetType ?? ""} className="rounded-md border border-gray-300 px-2 py-2 text-sm">
          <option value="">全部类型</option>
          <option value="agent">助手</option>
          <option value="workflow">流程</option>
          <option value="version">版本</option>
          <option value="knowledge">知识资料</option>
          <option value="memory">长期经验</option>
          <option value="evaluation">自动验收</option>
          <option value="run">运行反馈</option>
        </select>
      </label>
      <label className="flex min-w-56 flex-[2] flex-col gap-1 text-xs text-gray-600">操作关键词
        <input name="q" defaultValue={filters.query ?? ""} maxLength={200} className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
      </label>
      <button type="submit" className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white">筛选</button>
      {filtered ? <Link href="/activity" className="px-1 py-2 text-sm text-gray-500 hover:text-gray-800">清除筛选</Link> : null}
    </form>
    <AuditEventList events={rows.slice(0, PAGE_SIZE)} />
    <AuditEventPagination page={page} hasNext={hasNext} filters={filters} />
  </main>;
}
