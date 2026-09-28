import { RunListFilters } from "@/contracts/run";
import { pageFromSearchParam } from "@/lib/search-params";
import { runsHref } from "./run-filter-url";

export function runReturnHref(raw: string | undefined): string {
  if (!raw || raw.length > 512 || (raw !== "/runs" && !raw.startsWith("/runs?"))) return "/runs";
  const url = new URL(raw, "https://run-list.invalid");
  if (url.origin !== "https://run-list.invalid" || url.pathname !== "/runs" || url.hash) return "/runs";
  const parsed = RunListFilters.safeParse({
    status: url.searchParams.get("status") || undefined,
    sourceType: url.searchParams.get("source") || undefined,
    agentId: url.searchParams.get("agent") || undefined,
  });
  if (!parsed.success) return "/runs";
  return runsHref(parsed.data, pageFromSearchParam(url.searchParams.get("page") ?? undefined));
}
