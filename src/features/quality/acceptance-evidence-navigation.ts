import { z } from "zod";
import { AgentSummary } from "@/contracts/agent";
import { RunView } from "@/contracts/run";
import { EvaluationReviewNavigation } from "@/features/agents/evaluation-review-navigation";
import { firstSearchParam, MAX_PAGE_NUMBER, pageFromSearchParam } from "@/lib/search-params";

export const AcceptanceOverviewScope = z.object({
  query: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(1).max(MAX_PAGE_NUMBER).default(1),
}).strict();
export type AcceptanceOverviewScope = z.infer<typeof AcceptanceOverviewScope>;

export const AcceptanceEvidenceSelection = z.object({
  agentId: AgentSummary.shape.id.optional(),
  batchId: EvaluationReviewNavigation.shape.batchId,
  caseId: EvaluationReviewNavigation.shape.caseId,
  query: EvaluationReviewNavigation.shape.query,
  status: EvaluationReviewNavigation.shape.status,
  samplePage: EvaluationReviewNavigation.shape.samplePage,
}).strict().refine((value) =>
  Boolean(value.agentId) === Boolean(value.batchId)
  && (!value.caseId || Boolean(value.batchId))
  && (Boolean(value.batchId) || (!value.query && value.status === "all" && value.samplePage === 1)));
export type AcceptanceEvidenceSelection = z.infer<typeof AcceptanceEvidenceSelection>;

export const ACCEPTANCE_EVIDENCE_KEYS = ["evidenceAgent", "evaluationBatch", "evaluationCase", "evaluationQuery", "evaluationStatus", "evaluationSamplePage"] as const;

export function acceptanceEvidenceNavigation(query: Record<string, string | string[] | undefined>) {
  const overview = AcceptanceOverviewScope.parse({ query: firstSearchParam(query.q)?.trim().slice(0, 200) ?? "", page: pageFromSearchParam(query.page) });
  const duplicated = ACCEPTANCE_EVIDENCE_KEYS.some((key) => Array.isArray(query[key]));
  const selection = AcceptanceEvidenceSelection.safeParse({
    agentId: query.evidenceAgent, batchId: query.evaluationBatch, caseId: query.evaluationCase,
    query: query.evaluationQuery, status: query.evaluationStatus, samplePage: query.evaluationSamplePage,
  });
  return { overview, selection: !duplicated && selection.success ? selection.data : AcceptanceEvidenceSelection.parse({}), invalid: duplicated || !selection.success };
}

export function acceptanceOverviewHref(scope: AcceptanceOverviewScope): string {
  const state = AcceptanceOverviewScope.parse(scope);
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.page > 1) params.set("page", String(state.page));
  return params.size ? `/acceptance?${params}` : "/acceptance";
}

export function acceptanceEvidenceHref(scope: AcceptanceOverviewScope, selection: AcceptanceEvidenceSelection): string {
  const state = AcceptanceEvidenceSelection.parse(selection);
  const url = new URL(acceptanceOverviewHref(scope), "https://acceptance.invalid");
  if (!state.batchId) return url.pathname + url.search;
  url.searchParams.set("evidenceAgent", state.agentId!);
  url.searchParams.set("evaluationBatch", state.batchId);
  if (state.caseId) url.searchParams.set("evaluationCase", state.caseId);
  if (state.query) url.searchParams.set("evaluationQuery", state.query);
  if (state.status !== "all") url.searchParams.set("evaluationStatus", state.status);
  if (state.samplePage > 1) url.searchParams.set("evaluationSamplePage", String(state.samplePage));
  return url.pathname + url.search + "#evidence";
}

export function acceptanceHistoryHref(agentId: string, navigation: EvaluationReviewNavigation, scope: AcceptanceOverviewScope): string {
  return acceptanceEvidenceHref(scope, AcceptanceEvidenceSelection.parse({
    agentId: navigation.batchId ? agentId : undefined, batchId: navigation.batchId, caseId: navigation.caseId,
    query: navigation.query, status: navigation.status, samplePage: navigation.samplePage,
  }));
}

export function acceptanceReturnNavigation(raw: string | undefined) {
  if (!raw || raw.length > 4096 || !raw.startsWith("/acceptance")) return null;
  const url = new URL(raw, "https://acceptance.invalid");
  if (url.origin !== "https://acceptance.invalid" || url.pathname !== "/acceptance" || url.hash !== "#evidence") return null;
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!["q", "page", ...ACCEPTANCE_EVIDENCE_KEYS].includes(key) || Object.hasOwn(query, key)) return null;
    query[key] = value;
  }
  const scope = AcceptanceOverviewScope.safeParse({ query: query.q, page: query.page });
  const parsed = acceptanceEvidenceNavigation(query);
  return scope.success && !parsed.invalid && parsed.selection.agentId && parsed.selection.batchId && parsed.selection.caseId
    ? { ...parsed, overview: scope.data }
    : null;
}

export function acceptanceReturnHref(raw: string | undefined): string | null {
  const parsed = acceptanceReturnNavigation(raw);
  return parsed ? acceptanceEvidenceHref(parsed.overview, parsed.selection) : null;
}

export function acceptanceRunDetailHref(agentId: string, runId: string, navigation: EvaluationReviewNavigation, scope: AcceptanceOverviewScope): string {
  const href = acceptanceHistoryHref(agentId, navigation, scope);
  if (!acceptanceReturnHref(href)) throw new Error("验收返回位置缺少完整定位");
  return `/runs/${RunView.shape.id.parse(runId)}?${new URLSearchParams({ from: href })}`;
}
