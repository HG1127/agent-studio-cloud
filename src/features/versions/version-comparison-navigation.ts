import { z } from "zod";

const Identifier = z.string().uuid().transform((value) => value.toLowerCase());
export const VersionComparisonSelection = z.object({ from: Identifier, to: Identifier })
  .refine((value) => value.from !== value.to, "请选择两份不同的已保存版本");
export type VersionComparisonSelection = z.infer<typeof VersionComparisonSelection>;

export function versionComparisonHref(agentId: string, selection: VersionComparisonSelection): string {
  const agent = Identifier.parse(agentId);
  const pair = VersionComparisonSelection.parse(selection);
  return `/agents/${agent}/versions/compare?${new URLSearchParams(pair)}`;
}

export function versionComparisonDetailsHref(agentId: string, versionId: string, selection: VersionComparisonSelection): string {
  const agent = Identifier.parse(agentId);
  const version = Identifier.parse(versionId);
  const pair = VersionComparisonSelection.parse(selection);
  if (version !== pair.from && version !== pair.to) throw new Error("Comparison selected version mismatch");
  return `/agents/${agent}/versions/${version}?${new URLSearchParams({ source: "compare", ...pair })}`;
}

export function frozenVersionComparisonReturnHref(agentId: string, versionId: string, query: Record<string, string | string[] | undefined>): string | null {
  if (query.source !== "compare") return null;
  const agent = Identifier.safeParse(agentId), version = Identifier.safeParse(versionId), pair = VersionComparisonSelection.safeParse(query);
  if (!agent.success || !version.success || !pair.success || version.data !== pair.data.from && version.data !== pair.data.to) return null;
  return versionComparisonHref(agent.data, pair.data);
}
