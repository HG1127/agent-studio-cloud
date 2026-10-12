import { z } from "zod";
import { EvaluationCaseResultView, EvaluationRunView } from "@/contracts/evaluation";
import { RunView } from "@/contracts/run";
import { MAX_PAGE_NUMBER } from "@/lib/search-params";

const Page = z.coerce.number().int().min(1).max(MAX_PAGE_NUMBER).default(1);
export const EvaluationReviewNavigation = z.object({
  batchId: EvaluationRunView.shape.id.optional(),
  caseId: EvaluationCaseResultView.shape.caseId.optional(),
  query: z.string().max(100).default(""),
  status: z.enum(["all", ...EvaluationCaseResultView.shape.status.options]).default("all"),
  samplePage: Page,
  versionsPage: Page,
  archivedCasesPage: Page,
  evaluationRunsPage: Page,
}).strict().refine((value) => !value.caseId || Boolean(value.batchId));
export type EvaluationReviewNavigation = z.infer<typeof EvaluationReviewNavigation>;

export const EVALUATION_REVIEW_KEYS = ["evaluationBatch", "evaluationCase", "evaluationQuery", "evaluationStatus", "evaluationSamplePage", "versionsPage", "archivedCasesPage", "evaluationRunsPage"] as const;

export function evaluationReviewNavigation(query: Record<string, string | string[] | undefined>) {
  const invalid = EVALUATION_REVIEW_KEYS.some((key) => Array.isArray(query[key]));
  const parsed = EvaluationReviewNavigation.safeParse({
    batchId: query.evaluationBatch, caseId: query.evaluationCase, query: query.evaluationQuery,
    status: query.evaluationStatus, samplePage: query.evaluationSamplePage,
    versionsPage: query.versionsPage, archivedCasesPage: query.archivedCasesPage, evaluationRunsPage: query.evaluationRunsPage,
  });
  return { state: !invalid && parsed.success ? parsed.data : EvaluationReviewNavigation.parse({}), invalid: invalid || !parsed.success };
}

export function evaluationReviewHref(agentId: string, navigation: EvaluationReviewNavigation): string {
  const state = EvaluationReviewNavigation.parse(navigation);
  const params = new URLSearchParams();
  params.set("versionsPage", String(state.versionsPage));
  params.set("archivedCasesPage", String(state.archivedCasesPage));
  params.set("evaluationRunsPage", String(state.evaluationRunsPage));
  if (state.batchId) params.set("evaluationBatch", state.batchId);
  if (state.caseId) params.set("evaluationCase", state.caseId);
  if (state.query) params.set("evaluationQuery", state.query);
  if (state.status !== "all") params.set("evaluationStatus", state.status);
  if (state.samplePage > 1) params.set("evaluationSamplePage", String(state.samplePage));
  return `/agents/${RunView.shape.agentId.parse(agentId)}?${params}#evaluation`;
}

export function evaluationReturnHref(raw: string | undefined): string | null {
  if (!raw || raw.length > 2048 || !raw.startsWith("/agents/")) return null;
  const url = new URL(raw, "https://evaluation.invalid");
  if (url.origin !== "https://evaluation.invalid" || url.hash !== "#evaluation") return null;
  const agent = RunView.shape.agentId.safeParse(url.pathname.slice("/agents/".length));
  if (!agent.success) return null;
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!(EVALUATION_REVIEW_KEYS as readonly string[]).includes(key) || Object.hasOwn(query, key)) return null;
    query[key] = value;
  }
  const parsed = evaluationReviewNavigation(query);
  return !parsed.invalid && parsed.state.batchId && parsed.state.caseId ? evaluationReviewHref(agent.data, parsed.state) : null;
}

export function evaluationRunDetailHref(agentId: string, runId: string, navigation: EvaluationReviewNavigation): string {
  return `/runs/${RunView.shape.id.parse(runId)}?${new URLSearchParams({ from: evaluationReviewHref(agentId, navigation) })}`;
}
