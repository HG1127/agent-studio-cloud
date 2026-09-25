import Link from "next/link";
import type { AuditEventAction, AuditEventFilters, AuditEventView } from "@/contracts/audit-event";

const ACTION_LABELS: Record<AuditEventAction, string> = {
  "agent.created": "创建助手",
  "agent.imported": "导入助手",
  "agent.updated": "修改助手",
  "agent.archived": "停用助手",
  "agent.restored": "恢复助手",
  "workflow.saved": "保存流程",
  "workflow.auto_fixed": "自动修复流程",
  "version.published": "发布版本",
  "version.restored": "恢复版本",
  "knowledge.uploaded": "上传资料",
  "knowledge.reingested": "重新解析资料",
  "knowledge.archived": "归档资料",
  "knowledge.restored": "恢复资料",
  "memory.archived": "停用经验",
  "memory.restored": "恢复经验",
  "evaluation_case.created": "创建验收样例",
  "evaluation_case.updated": "修改验收样例",
  "evaluation_case.archived": "归档验收样例",
  "evaluation_case.restored": "恢复验收样例",
  "evaluation.started": "启动自动验收",
  "evaluation.completed": "完成自动验收",
  "version.promoted": "验收通过上线",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function AuditEventList({ events }: { events: AuditEventView[] }) {
  if (events.length === 0) {
    return <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">没有符合条件的操作记录</p>;
  }
  return <ol className="space-y-3">
    {events.map((event) => (
      <li key={event.id} className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium text-gray-900">{event.summary}</p>
            <p className="mt-1 text-xs text-gray-500">{event.actorName} · {formatTime(event.createdAt)}</p>
          </div>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{ACTION_LABELS[event.action]}</span>
        </div>
        {Object.keys(event.data).length > 0 ? <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-500">查看变更数据（开发者数据）</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-gray-50 p-3 text-xs">{JSON.stringify(event.data, null, 2)}</pre>
        </details> : null}
      </li>
    ))}
  </ol>;
}

function pageHref(page: number, filters: AuditEventFilters) {
  const params = new URLSearchParams();
  if (filters.targetType) params.set("type", filters.targetType);
  if (filters.query) params.set("q", filters.query);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/activity?${query}` : "/activity";
}

export function AuditEventPagination({ page, hasNext, filters }: {
  page: number;
  hasNext: boolean;
  filters: AuditEventFilters;
}) {
  if (page === 1 && !hasNext) return null;
  return <nav aria-label="操作记录翻页" className="flex items-center justify-between gap-3 text-sm">
    {page > 1
      ? <Link href={pageHref(page - 1, filters)} className="rounded-md border border-gray-300 px-3 py-1.5 hover:border-gray-500">上一页</Link>
      : <span />}
    <span className="text-gray-500">第 {page} 页</span>
    {hasNext
      ? <Link href={pageHref(page + 1, filters)} className="rounded-md border border-gray-300 px-3 py-1.5 hover:border-gray-500">下一页</Link>
      : <span />}
  </nav>;
}
