import { z } from "zod";
import { MAX_PAGE_NUMBER } from "@/lib/search-params";

const ViewPage = z.string().regex(/^[1-9]\d*$/).refine((value) => Number.isSafeInteger(Number(value)) && Number(value) <= MAX_PAGE_NUMBER).optional().transform((value) => value ? Number(value) : 1);
export const FrozenVersionNavigation = z.object({
  source: z.enum(["history", "web-tools"]).optional().default("history"),
  versionsPage: ViewPage, archivedCasesPage: ViewPage, evaluationRunsPage: ViewPage,
});
export type FrozenVersionNavigation = z.infer<typeof FrozenVersionNavigation>;

export function frozenVersionHref(agentId: string, versionId: string, navigation: FrozenVersionNavigation): string {
  const query = new URLSearchParams();
  if (navigation.source === "web-tools") query.set("source", "web-tools");
  else for (const key of ["versionsPage", "archivedCasesPage", "evaluationRunsPage"] as const) {
    if (navigation[key] > 1) query.set(key, String(navigation[key]));
  }
  return `/agents/${agentId}/versions/${versionId}` + (query.size ? "?" + query : "");
}
export function frozenVersionReturnHref(agentId: string, versionId: string, navigation: FrozenVersionNavigation): string {
  if (navigation.source === "web-tools") return "/web-tools?" + new URLSearchParams({ version: versionId });
  const query = new URLSearchParams();
  for (const key of ["versionsPage", "archivedCasesPage", "evaluationRunsPage"] as const) {
    if (navigation[key] > 1) query.set(key, String(navigation[key]));
  }
  return `/agents/${agentId}` + (query.size ? "?" + query : "") + "#versions";
}
