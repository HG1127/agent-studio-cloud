import { RunView } from "@/contracts/run";
import { HARNESS_SEARCH_KEYS, HarnessNavigation, harnessNavigation } from "./harness-filter-state";

export { HarnessNavigation, harnessNavigation } from "./harness-filter-state";

export function harnessParams(navigation: HarnessNavigation) {
  const state = HarnessNavigation.parse(navigation);
  const params = new URLSearchParams();
  if (state.runId) params.set("run", state.runId);
  if (state.list.query) params.set("runQuery", state.list.query);
  if (state.list.attention) params.set("runAttention", "1");
  if (state.trace.query) params.set("traceQuery", state.trace.query);
  if (state.trace.nodeId) params.set("traceNode", state.trace.nodeId);
  if (state.trace.attention) params.set("traceAttention", "1");
  if (state.trace.kind && state.trace.kind !== "all") params.set("traceKind", state.trace.kind);
  if (state.trace.range === "history") params.set("traceRange", "history");
  if (state.trace.page !== undefined && state.trace.page > 1) params.set("tracePage", String(state.trace.page));
  if (state.context.page > 1) params.set("contextPage", String(state.context.page));
  if (state.context.query) params.set("contextQuery", state.context.query);
  return params;
}

export function harnessConsoleHref(navigation: HarnessNavigation, anchor?: "saved-context" | "diagnostic-trace") {
  const params = harnessParams(navigation);
  return `/harness${params.size ? `?${params}` : ""}${anchor ? `#${anchor}` : ""}`;
}

export function harnessRunHref(runId: string, navigation = HarnessNavigation.parse({})): string {
  const id = RunView.shape.id.parse(runId);
  const sameRun = navigation.runId?.toLowerCase() === id.toLowerCase();
  const empty = HarnessNavigation.parse({});
  return harnessConsoleHref({ ...navigation, runId: id,
    ...(sameRun ? {} : { trace: empty.trace, context: empty.context }),
  });
}

export function harnessReturnNavigation(raw: string | undefined): HarnessNavigation | null {
  if (!raw || raw.length > 8192 || !raw.startsWith("/harness?")) return null;
  const url = new URL(raw, "https://harness.invalid");
  if (url.origin !== "https://harness.invalid" || url.pathname !== "/harness" || url.hash) return null;
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!(HARNESS_SEARCH_KEYS as readonly string[]).includes(key) || Object.hasOwn(params, key)) return null;
    params[key] = value;
  }
  const parsed = harnessNavigation(params);
  return !parsed.invalidRun && parsed.state.runId && !parsed.invalidList && !parsed.invalidTrace && parsed.context.success ? parsed.state : null;
}

export function harnessRunDetailHref(runId: string, anchor?: "run-controls" | "run-waiting" | "trace" | "result" | "run-failure", navigation?: HarnessNavigation): string {
  return `/runs/${RunView.shape.id.parse(runId)}?${new URLSearchParams({ from: harnessRunHref(runId, navigation) })}${anchor ? `#${anchor}` : ""}`;
}
