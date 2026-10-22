import { ToolOperationListInput } from "@/contracts/tool-operation";

export function toolOperationsHref(input: ToolOperationListInput): string {
  const filters = ToolOperationListInput.parse(input);
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.sourceRunId) query.set("sourceRunId", filters.sourceRunId.toLowerCase());
  if (filters.limit !== 20) query.set("limit", String(filters.limit));
  if (filters.before) query.set("before", filters.before);
  if (filters.beforeId) query.set("beforeId", filters.beforeId.toLowerCase());
  return "/tool-operations" + (query.size ? "?" + query.toString() : "");
}

export function toolOperationReturnFilters(raw: string | undefined): ToolOperationListInput | null {
  if (!raw || raw.length > 512 || (raw !== "/tool-operations" && !raw.startsWith("/tool-operations?"))) return null;
  const url = new URL(raw, "https://tool-operation.invalid");
  if (url.origin !== "https://tool-operation.invalid" || url.pathname !== "/tool-operations" || url.hash) return null;
  const query: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(query, key)) return null;
    query[key] = value;
  }
  const parsed = ToolOperationListInput.safeParse(query);
  return parsed.success ? parsed.data : null;
}

export function toolOperationReturnHref(raw: string | undefined, sourceRunId?: string): string | null {
  const filters = toolOperationReturnFilters(raw);
  if (!filters || (sourceRunId && filters.sourceRunId && filters.sourceRunId.toLowerCase() !== sourceRunId.toLowerCase())) return null;
  return toolOperationsHref(filters);
}

export function toolOperationRunHref(sourceRunId: string, filters: ToolOperationListInput): string {
  const reference = ToolOperationListInput.parse({ sourceRunId });
  const from = toolOperationReturnHref(toolOperationsHref(filters), reference.sourceRunId);
  if (!from) throw new Error("Source task does not match the operation list scope");
  return "/runs/" + reference.sourceRunId!.toLowerCase() + "?from=" + encodeURIComponent(from);
}
