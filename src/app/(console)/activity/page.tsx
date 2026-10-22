import Link from "next/link";
import { AuditEventFilters, AuditTargetType } from "@/contracts/audit-event";
import { AuditEventList, AuditEventPagination } from "@/features/activity/AuditEventList";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { firstSearchParam, pageFromSearchParam } from "@/lib/search-params";
import { listAuditEvents } from "@/server/queries/audit-events";
import { withSafeQueryError } from "@/server/security/query-error";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function ActivityPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsedType = AuditTargetType.safeParse(firstSearchParam(params.type));
  const parsedFilters = AuditEventFilters.safeParse({
    targetType: parsedType.success ? parsedType.data : undefined,
    query: firstSearchParam(params.q)?.trim().slice(0, 200) || undefined,
  });
  const filters = parsedFilters.success ? parsedFilters.data : {};
  const page = pageFromSearchParam(params.page);
  const rows = await withSafeQueryError(() => listAuditEvents(DEMO_WORKSPACE_ID, filters, {
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
  }), "activity-page");
  const hasNext = rows.length > PAGE_SIZE;
  const filtered = Boolean(filters.targetType || filters.query);
  return <main className="page-shell">
    <PageHeader eyebrow="审计与追踪" title="操作记录" description="查看助手、流程、版本、资料、经验、运行反馈和自动验收的关键变更。时间按北京时间显示。" action={<PageRefreshButton />} />
    <form method="get" className="content-card flex flex-wrap items-end gap-3">
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
    <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">这里只展示已写入的关键变更；被系统拒绝的操作尚无完整记录，不能当作全部安全审计依据。</p>
    <section className="content-card"><AuditEventList events={rows.slice(0, PAGE_SIZE)} filtered={filtered} page={page} filters={filters} /><div className="mt-4"><AuditEventPagination page={page} hasNext={hasNext} filters={filters} /></div></section>
  </main>;
}
