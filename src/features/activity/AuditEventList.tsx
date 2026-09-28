import Link from "next/link";
import { Activity, ArrowRight, ChevronLeft, ChevronRight, History } from "lucide-react";
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
  "run.feedback_saved": "提交运行反馈",
  "run.feedback_regression_created": "反馈加入验收",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function destinationFor(event: AuditEventView): { href: string; label: string } {
  switch (event.targetType) {
    case "agent":
      return event.targetId && event.action !== "agent.archived"
        ? { href: `/agents/${event.targetId}`, label: "打开相关助手" }
        : { href: "/agents", label: "前往助手列表" };
    case "run":
      return event.targetId
        ? { href: `/runs/${event.targetId}#feedback`, label: "查看相关运行反馈" }
        : { href: "/runs", label: "前往运行记录" };
    case "knowledge":
      return { href: "/knowledge", label: "前往资料列表" };
    case "memory":
      return { href: "/memory", label: "前往成长中心" };
    case "evaluation":
      return { href: "/acceptance", label: "前往验收中心" };
    case "version":
      return { href: "/releases", label: "前往发布中心" };
    case "workflow":
      return { href: "/agents", label: "前往助手列表" };
  }
}

export function AuditEventList({ events, filtered = false, page = 1, filters = {} }: { events: AuditEventView[]; filtered?: boolean; page?: number; filters?: AuditEventFilters }) {
  if (events.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center"><History className="mx-auto size-7 text-slate-400" /><p className="mt-3 text-sm font-medium text-slate-700">{page > 1 ? "当前页没有操作记录" : filtered ? "没有符合筛选条件的操作记录" : "还没有操作记录"}</p><p className="mt-1 text-xs leading-5 text-slate-500">{page > 1 ? "记录可能已变化，回到第一页继续查看；当前页为空不代表历史记录已删除。" : filtered ? "可以调整记录类型或关键词，再查看一次。" : "创建、发布等关键操作完成后，会在这里留下记录。"}</p>{page > 1 ? <Link href={pageHref(1, filters)} className="mt-3 inline-flex text-sm font-semibold text-indigo-700 hover:underline">回到第一页</Link> : filtered ? <Link href="/activity" className="mt-3 inline-flex text-sm font-semibold text-indigo-700 hover:underline">查看全部记录</Link> : null}</div>;
  }
  return <ol className="relative space-y-0 before:absolute before:bottom-5 before:left-5 before:top-5 before:w-px before:bg-slate-200 sm:before:left-6">
    {events.map((event) => {
      const destination = destinationFor(event);
      return <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0 sm:gap-4">
        <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 sm:size-12"><Activity className="size-4" /></span>
        <article className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900">{event.summary}</p>
            <p className="mt-1 text-xs text-slate-500">{event.actorName} · {formatTime(event.createdAt)}</p>
          </div>
          <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">{ACTION_LABELS[event.action]}</span>
        </div>
        <Link href={destination.href} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">{destination.label}<ArrowRight aria-hidden="true" className="size-3.5" /></Link>
        {Object.keys(event.data).length > 0 ? <details className="mt-3 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-indigo-700">查看变更数据（开发者数据）</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-slate-50 p-3 text-xs">{JSON.stringify(event.data, null, 2)}</pre>
        </details> : null}
        </article>
      </li>;
    })}
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
      ? <Link href={pageHref(page - 1, filters)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 hover:border-indigo-200 hover:text-indigo-700"><ChevronLeft className="size-4" />上一页</Link>
      : <span />}
    <span className="text-gray-500">第 {page} 页</span>
    {hasNext
      ? <Link href={pageHref(page + 1, filters)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 hover:border-indigo-200 hover:text-indigo-700">下一页<ChevronRight className="size-4" /></Link>
      : <span />}
  </nav>;
}
