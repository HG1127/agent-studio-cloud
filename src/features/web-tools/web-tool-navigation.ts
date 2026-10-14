import { z } from "zod";
import { RunView } from "@/contracts/run";
import { AgentTargetOption } from "@/contracts/agent";

export const WebToolNavigation = z.object({
  versionId: AgentTargetOption.shape.versionId.optional(),
  runId: RunView.shape.id.optional(),
}).strict().refine((value) => !value.runId || Boolean(value.versionId));
export type WebToolNavigation = z.infer<typeof WebToolNavigation>;

export function webToolNavigation(raw: Record<string, string | string[] | undefined>) {
  const parsed = WebToolNavigation.safeParse({ versionId: raw.version, runId: raw.trial });
  return parsed.success ? { state: parsed.data, invalid: false } : { state: {} as WebToolNavigation, invalid: true };
}

export function webToolHref(state: WebToolNavigation): string {
  const valid = WebToolNavigation.parse(state);
  const params = new URLSearchParams();
  if (valid.versionId) params.set("version", valid.versionId);
  if (valid.runId) params.set("trial", valid.runId);
  return params.size ? `/web-tools?${params}` : "/web-tools";
}

export function webToolRunHref(versionId: string, runId: string): string {
  return `/runs/${RunView.shape.id.parse(runId)}?${new URLSearchParams({ from: webToolHref({ versionId, runId }) })}`;
}

export function webToolReturnNavigation(raw: string): WebToolNavigation | null {
  if (!raw.startsWith("/web-tools?") || raw.length > 512) return null;
  const url = new URL(raw, "https://web-tool.invalid");
  if (url.origin !== "https://web-tool.invalid" || url.pathname !== "/web-tools" || url.hash) return null;
  if ([...url.searchParams.keys()].some((key) => !["version", "trial"].includes(key) || url.searchParams.getAll(key).length !== 1)) return null;
  const parsed = webToolNavigation({ version: url.searchParams.get("version") ?? undefined, trial: url.searchParams.get("trial") ?? undefined });
  return !parsed.invalid && parsed.state.versionId && parsed.state.runId ? parsed.state : null;
}
