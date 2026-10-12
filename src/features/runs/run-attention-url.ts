import { z } from "zod";
import { RunListFilters } from "@/contracts/run";
import { firstSearchParam, MAX_PAGE_NUMBER, pageFromSearchParam } from "@/lib/search-params";

export const AttentionListState = RunListFilters.pick({ sourceType: true, agentId: true }).extend({
  approvalPage: z.number().int().min(1).max(MAX_PAGE_NUMBER).default(1),
  eventPage: z.number().int().min(1).max(MAX_PAGE_NUMBER).default(1),
  failedPage: z.number().int().min(1).max(MAX_PAGE_NUMBER).default(1),
});
export type AttentionListState = z.infer<typeof AttentionListState>;
export type AttentionPageKey = Extract<keyof z.infer<typeof AttentionListState>, `${string}Page`>;

export function attentionStateFromSearch(params: Record<string, string | string[] | undefined>) {
  return AttentionListState.safeParse({
    sourceType: firstSearchParam(params.source) || undefined,
    agentId: firstSearchParam(params.agent) || undefined,
    approvalPage: pageFromSearchParam(params.approvalPage),
    eventPage: pageFromSearchParam(params.eventPage),
    failedPage: pageFromSearchParam(params.failedPage),
  });
}

export function attentionHref(state: AttentionListState): string {
  const params = new URLSearchParams();
  if (state.sourceType) params.set("source", state.sourceType);
  if (state.agentId) params.set("agent", state.agentId);
  for (const key of ["approvalPage", "eventPage", "failedPage"] as const) {
    if (state[key] > 1) params.set(key, String(state[key]));
  }
  return `/runs/attention${params.size ? `?${params}` : ""}`;
}

export function attentionReturnHref(url: URL): string | null {
  const allowed = new Set(["source", "agent", "approvalPage", "eventPage", "failedPage"]);
  const keys = Array.from(url.searchParams.keys());
  if (url.pathname !== "/runs/attention" || keys.some((key) => !allowed.has(key)) || new Set(keys).size !== keys.length) return null;
  for (const key of ["approvalPage", "eventPage", "failedPage"] as const) {
    const value = url.searchParams.get(key);
    if (value !== null && (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > MAX_PAGE_NUMBER)) return null;
  }
  const parsed = attentionStateFromSearch(Object.fromEntries(url.searchParams));
  return parsed.success ? attentionHref(parsed.data) : null;
}
