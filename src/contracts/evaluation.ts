import { z } from "zod";

export const EvaluationExpectation = z.object({
  path: z.string().default(""),
  operator: z.enum(["equals", "contains", "exists"]),
  value: z.unknown().optional(),
}).superRefine((expectation, context) => {
  if (expectation.operator === "contains" && (typeof expectation.value !== "string" || !expectation.value.trim())) {
    context.addIssue({ code: "custom", path: ["value"], message: "包含检查必须填写预期文字" });
  }
  if (expectation.operator === "equals" && !("value" in expectation)) {
    context.addIssue({ code: "custom", path: ["value"], message: "等于检查必须填写预期值" });
  }
});
export type EvaluationExpectation = z.infer<typeof EvaluationExpectation>;

export const EvaluationCaseCreateInput = z.object({
  agentId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  input: z.record(z.string(), z.unknown()),
  expectations: z.array(EvaluationExpectation).max(20).default([]),
});
export type EvaluationCaseCreateInput = z.infer<typeof EvaluationCaseCreateInput>;

export const EvaluationCaseUpdateInput = EvaluationCaseCreateInput.extend({ caseId: z.string().uuid() });
export type EvaluationCaseUpdateInput = z.infer<typeof EvaluationCaseUpdateInput>;

export const EvaluationCaseView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
  expectations: z.array(EvaluationExpectation),
  createdAt: z.string(),
});
export type EvaluationCaseView = z.infer<typeof EvaluationCaseView>;

export const EvaluationCaseResultView = z.object({
  caseId: z.string().uuid(),
  caseName: z.string(),
  status: z.enum(["running", "passed", "failed"]),
  error: z.string().nullable(),
  runId: z.string().uuid().nullable(),
});
export type EvaluationCaseResultView = z.infer<typeof EvaluationCaseResultView>;

export const EvaluationRunView = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(["running", "completed"]),
  totalCount: z.number().int().nonnegative(),
  passedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  results: z.array(EvaluationCaseResultView).default([]),
});
export type EvaluationRunView = z.infer<typeof EvaluationRunView>;

export const EvaluationActionResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type EvaluationActionResult = z.infer<typeof EvaluationActionResult>;

export const EvaluationCaseArchiveInput = z.object({
  agentId: z.string().uuid(),
  caseId: z.string().uuid(),
  archived: z.boolean(),
});
export type EvaluationCaseArchiveInput = z.infer<typeof EvaluationCaseArchiveInput>;
