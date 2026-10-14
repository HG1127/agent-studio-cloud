import { z } from "zod";
import { RunStatus, RunSummary } from "@/contracts/run";
import { MAX_PAGE_NUMBER } from "@/lib/search-params";
import { runReturnHref } from "./run-return-url";

export const CollaborationListState = z.object({
  query: z.string().trim().max(100).default(""),
  sourceType: z.enum(["agent_call", "handoff"]).optional(),
  status: RunStatus.optional(),
  page: z.number().int().min(1).max(MAX_PAGE_NUMBER).default(1),
});
export type CollaborationListState = z.infer<typeof CollaborationListState>;

export const CollaborationParent = z.object({
  runId: RunSummary.shape.id,
  state: CollaborationListState,
});
export type CollaborationParent = z.infer<typeof CollaborationParent>;

type Search = Record<string, string | string[] | undefined>;
const stateKeys = ["colQuery", "colType", "colStatus", "colPage"] as const;
const parentKeys = ["parentQuery", "parentType", "parentStatus", "parentPage"] as const;

function parseState(params: Search, keys: typeof stateKeys | typeof parentKeys) {
  const [query, sourceType, status, page] = keys.map((key) => params[key]);
  if ([query, sourceType, status, page].some(Array.isArray)) return null;
  if (page !== undefined && (typeof page !== "string" || !/^[1-9]\d{0,4}$/.test(page))) return null;
  const parsed = CollaborationListState.safeParse({
    query: query ?? "",
    sourceType: sourceType || undefined,
    status: status || undefined,
    page: page === undefined ? 1 : Number(page),
  });
  return parsed.success ? parsed.data : null;
}

export function collaborationNavigation(params: Search) {
  const parsedState = parseState(params, stateKeys);
  const hasParent = params.parent !== undefined || parentKeys.some((key) => params[key] !== undefined);
  const parentState = hasParent ? parseState(params, parentKeys) : null;
  const parsedParent = hasParent && parentState
    ? CollaborationParent.safeParse({ runId: params.parent, state: parentState })
    : null;
  return {
    state: parsedState ?? CollaborationListState.parse({}),
    invalidState: parsedState === null,
    parent: parsedParent?.success ? parsedParent.data : null,
    invalidParent: hasParent && !parsedParent?.success,
    backHref: runReturnHref(typeof params.from === "string" ? params.from : undefined),
  };
}

function appendState(params: URLSearchParams, state: CollaborationListState, keys: typeof stateKeys | typeof parentKeys) {
  if (state.query) params.set(keys[0], state.query);
  if (state.sourceType) params.set(keys[1], state.sourceType);
  if (state.status) params.set(keys[2], state.status);
  if (state.page > 1) params.set(keys[3], String(state.page));
}

export function collaborationParams(backHref: string, state: CollaborationListState, parent: CollaborationParent | null = null) {
  const params = new URLSearchParams();
  const safeBackHref = runReturnHref(backHref);
  if (safeBackHref !== "/runs") params.set("from", safeBackHref);
  appendState(params, CollaborationListState.parse(state), stateKeys);
  if (parent) {
    const safeParent = CollaborationParent.parse(parent);
    params.set("parent", safeParent.runId);
    appendState(params, safeParent.state, parentKeys);
  }
  return params;
}

export function collaborationHref(runId: string, backHref: string, state: CollaborationListState, parent: CollaborationParent | null = null) {
  const params = collaborationParams(backHref, state, parent);
  return `/runs/${RunSummary.shape.id.parse(runId)}${params.size ? `?${params}` : ""}#collaboration`;
}

export function childRunHref(childId: string, parentId: string, backHref: string, state: CollaborationListState) {
  const params = collaborationParams(backHref, CollaborationListState.parse({}), { runId: parentId, state });
  return `/runs/${RunSummary.shape.id.parse(childId)}?${params}`;
}
