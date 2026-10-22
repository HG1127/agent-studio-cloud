import type { RunListFilters } from "@/contracts/run";

export function runsHref(filters: RunListFilters, page = 1): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.sourceType) params.set("source", filters.sourceType);
  if (filters.agentId) params.set("agent", filters.agentId);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/runs?${query}` : "/runs";
}

export function runDetailHref(runId: string, filters: RunListFilters, page = 1): string {
  const returnHref = runsHref(filters, page);
  if (returnHref === "/runs") return `/runs/${runId}`;
  return `/runs/${runId}?${new URLSearchParams({ from: returnHref })}`;
}
