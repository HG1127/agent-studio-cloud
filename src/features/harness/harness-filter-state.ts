import { z } from "zod";
import { RunStepView, RunView } from "@/contracts/run";
import { MAX_PAGE_NUMBER } from "@/lib/search-params";
import { TraceKindFilter } from "./trace-kind-filter";

const query = z.string().trim().max(100).default("");
export const CONTEXT_PAGE_SIZE = 10;
export const RunContextFilters = z.object({
  page: z.string().regex(/^[1-9]\d*$/).refine((value) => Number.isSafeInteger(Number(value)) && Number(value) <= MAX_PAGE_NUMBER).optional().transform((value) => value ? Number(value) : 1),
  query: z.string().max(100).optional().transform((value) => (value ?? "").trim()),
});
export type RunContextFilters = z.infer<typeof RunContextFilters>;

export const HarnessRunFilters = z.object({ query, attention: z.boolean().default(false) });
export const HarnessTraceFilters = z.object({
  query, nodeId: RunStepView.shape.nodeId.max(1000).refine((value) => new URLSearchParams({ n: value }).toString().length <= 3002).default(""), attention: z.boolean().default(false),
  kind: TraceKindFilter.optional(),
  range: z.literal("history").optional(),
  page: z.number().int().min(1).max(MAX_PAGE_NUMBER).optional(),
});
export const HarnessNavigation = z.object({
  runId: RunView.shape.id.optional(),
  list: HarnessRunFilters.default({ query: "", attention: false }),
  trace: HarnessTraceFilters.default({ query: "", nodeId: "", attention: false }),
  context: z.object({ page: z.number().int().min(1).max(MAX_PAGE_NUMBER), query }).default({ page: 1, query: "" }),
}).superRefine((state, context) => {
  if (state.trace.range === "history" && !state.runId) context.addIssue({ code: "custom", path: ["trace", "range"], message: "历史轨迹必须指定任务" });
  if (state.trace.page !== undefined && state.trace.range !== "history") context.addIssue({ code: "custom", path: ["trace", "page"], message: "历史页码必须指定历史范围" });
});
export type HarnessNavigation = z.infer<typeof HarnessNavigation>;

const attention = z.enum(["1"]).optional().transform((value) => value === "1");
type Search = Record<string, string | string[] | undefined>;
export const HARNESS_SEARCH_KEYS = ["run", "runQuery", "runAttention", "traceQuery", "traceNode", "traceAttention", "traceKind", "traceRange", "tracePage", "contextPage", "contextQuery"] as const;

export function harnessNavigation(params: Search) {
  const run = RunView.shape.id.optional().safeParse(params.run);
  const list = z.object({ query, attention }).safeParse({ query: params.runQuery, attention: params.runAttention });
  const trace = z.object({ query, nodeId: HarnessTraceFilters.shape.nodeId, attention, kind: HarnessTraceFilters.shape.kind,
    range: HarnessTraceFilters.shape.range,
    page: z.string().regex(/^[1-9]\d*$/).refine((value) => Number.isSafeInteger(Number(value)) && Number(value) <= MAX_PAGE_NUMBER).optional().transform((value) => value === undefined ? undefined : Number(value)),
  }).superRefine((state, context) => {
    if (state.range === "history" && (!run.success || !run.data)) context.addIssue({ code: "custom", path: ["range"], message: "历史轨迹必须指定任务" });
    if (state.page !== undefined && state.range !== "history") context.addIssue({ code: "custom", path: ["page"], message: "历史页码必须指定历史范围" });
  }).safeParse({
    query: params.traceQuery, nodeId: params.traceNode, attention: params.traceAttention,
    ...(params.traceKind === undefined ? {} : { kind: params.traceKind }),
    ...(params.traceRange === undefined ? {} : { range: params.traceRange }),
    ...(params.tracePage === undefined ? {} : { page: params.tracePage }),
  });
  const context = RunContextFilters.safeParse({ page: params.contextPage, query: params.contextQuery });
  return {
    state: HarnessNavigation.parse({
      runId: run.success ? run.data : undefined,
      list: list.success ? list.data : undefined,
      trace: trace.success ? trace.data : undefined,
      context: context.success ? context.data : undefined,
    }),
    invalidRun: !run.success,
    invalidList: !list.success,
    invalidTrace: !trace.success,
    context,
  };
}
