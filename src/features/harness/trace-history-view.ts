import type { TraceEventView } from "@/contracts/run";
import { MAX_PAGE_NUMBER } from "@/lib/search-params";
import type { HarnessNavigation } from "./harness-navigation";
import { traceKindCategory } from "./trace-kind-filter";

export const TRACE_HISTORY_PAGE_SIZE = 50;

export function traceHistoryView(events: readonly TraceEventView[], filters: HarnessNavigation["trace"]) {
  const keyword = filters.query.trim().toLocaleLowerCase("zh-CN");
  const scoped = events.filter((event) => (!filters.nodeId || event.nodeId === filters.nodeId)
    && (!keyword || `${event.title} ${event.detail ?? ""}`.toLocaleLowerCase("zh-CN").includes(keyword))
    && (!filters.kind || filters.kind === "all" || traceKindCategory(event.kind) === filters.kind));
  const attentionCount = scoped.filter((event) => event.level !== "info").length;
  const selected = filters.attention ? scoped.filter((event) => event.level !== "info") : scoped;
  const page = filters.page ?? 1;
  const availablePages = Math.max(1, Math.ceil(selected.length / TRACE_HISTORY_PAGE_SIZE));
  const lastPage = Math.min(MAX_PAGE_NUMBER, availablePages);
  const offset = (page - 1) * TRACE_HISTORY_PAGE_SIZE;
  return { total: events.length, scopedCount: scoped.length, attentionCount, selectedCount: selected.length,
    page, lastPage, pagesLimited: availablePages > MAX_PAGE_NUMBER, outOfRange: page > lastPage,
    events: selected.slice(offset, offset + TRACE_HISTORY_PAGE_SIZE) };
}

export type TraceHistoryPage = Omit<ReturnType<typeof traceHistoryView>, "events">;
