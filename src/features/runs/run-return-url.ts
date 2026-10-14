import { RunListFilters } from "@/contracts/run";
import { harnessReturnNavigation, harnessConsoleHref } from "@/features/harness/harness-navigation";
import { pageFromSearchParam } from "@/lib/search-params";
import { runsHref } from "./run-filter-url";
import { attentionReturnHref } from "./run-attention-url";
import { webToolHref, webToolReturnNavigation } from "@/features/web-tools/web-tool-navigation";
import { evaluationReturnHref } from "@/features/agents/evaluation-review-navigation";
import { acceptanceReturnHref } from "@/features/quality/acceptance-evidence-navigation";
import { toolOperationReturnHref } from "@/features/tool-operations/tool-operation-navigation";

export function runReturnHref(raw: string | undefined): string {
  if (raw?.startsWith("/tool-operations")) return toolOperationReturnHref(raw) ?? "/runs";
  if (raw?.startsWith("/acceptance")) return acceptanceReturnHref(raw) ?? "/runs";
  if (raw?.startsWith("/agents/")) return evaluationReturnHref(raw) ?? "/runs";
  if (raw?.startsWith("/web-tools?")) {
    const navigation = webToolReturnNavigation(raw);
    return navigation ? webToolHref(navigation) : "/runs";
  }
  if (raw?.startsWith("/harness?")) {
    const navigation = harnessReturnNavigation(raw);
    return navigation ? harnessConsoleHref(navigation) : "/runs";
  }
  if (!raw || raw.length > 512 || (raw !== "/runs" && !raw.startsWith("/runs?") && raw !== "/runs/attention" && !raw.startsWith("/runs/attention?"))) return "/runs";
  const url = new URL(raw, "https://run-list.invalid");
  if (url.origin !== "https://run-list.invalid" || url.hash) return "/runs";
  if (url.pathname === "/runs/attention") return attentionReturnHref(url) ?? "/runs";
  if (url.pathname !== "/runs") return "/runs";
  const parsed = RunListFilters.safeParse({
    status: url.searchParams.get("status") || undefined,
    sourceType: url.searchParams.get("source") || undefined,
    agentId: url.searchParams.get("agent") || undefined,
  });
  if (!parsed.success) return "/runs";
  return runsHref(parsed.data, pageFromSearchParam(url.searchParams.get("page") ?? undefined));
}
