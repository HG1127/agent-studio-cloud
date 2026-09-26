import { z } from "zod";
import { RunInputPayload } from "@/contracts/run";

const RESERVED_PATH_SEGMENTS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

export const MAX_EVALUATION_CASES = 100;
export const MAX_EVALUATION_EXPECTATIONS = 20;
const MAX_EVALUATION_CASE_BYTES = 128 * 1024;

function evaluationCaseSizeIssue(value: unknown): string | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_EVALUATION_CASE_BYTES
      ? "单条验收样例不能超过 128KB"
      : null;
  } catch {
    return "验收样例必须是可序列化的 JSON";
  }
}

export const EvaluationExpectation = z.object({
  path: z.string().max(200, "验收字段位置不能超过 200 个字符").refine((path) => !path || path.split(".").every((segment) => segment && !RESERVED_PATH_SEGMENTS.has(segment)), "验收字段位置格式不正确或使用了保留名称").default(""),
  operator: z.enum(["equals", "contains", "exists"]),
  value: z.json().optional(),
}).superRefine((expectation, context) => {
  if (expectation.operator === "contains" && (typeof expectation.value !== "string" || !expectation.value.trim())) {
    context.addIssue({ code: "custom", path: ["value"], message: "包含检查必须填写预期文字" });
  }
  if (expectation.operator === "equals" && !("value" in expectation)) {
    context.addIssue({ code: "custom", path: ["value"], message: "等于检查必须填写预期值" });
  }
});
export type EvaluationExpectation = z.infer<typeof EvaluationExpectation>;

const EvaluationCaseFields = z.object({
  agentId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  input: RunInputPayload,
  expectations: z.array(EvaluationExpectation).max(MAX_EVALUATION_EXPECTATIONS).default([]),
});
export const EvaluationCaseCreateInput = EvaluationCaseFields.superRefine((value, ctx) => {
  const issue = evaluationCaseSizeIssue(value);
  if (issue) ctx.addIssue({ code: "custom", message: issue });
});
export type EvaluationCaseCreateInput = z.infer<typeof EvaluationCaseCreateInput>;

export const EvaluationCaseUpdateInput = EvaluationCaseFields.extend({
  caseId: z.string().uuid(),
  expectedUpdatedAt: z.iso.datetime(),
}).superRefine((value, ctx) => {
  const issue = evaluationCaseSizeIssue(value);
  if (issue) ctx.addIssue({ code: "custom", message: issue });
});
export type EvaluationCaseUpdateInput = z.infer<typeof EvaluationCaseUpdateInput>;

export const EvaluationCaseView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
  expectations: z.array(EvaluationExpectation),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
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

export const EvaluationGenerateResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), createdCount: z.number().int().positive(), reused: z.boolean().optional() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type EvaluationGenerateResult = z.infer<typeof EvaluationGenerateResult>;

export const EvaluationCaseArchiveInput = z.object({
  agentId: z.string().uuid(),
  caseId: z.string().uuid(),
  archived: z.boolean(),
});
export type EvaluationCaseArchiveInput = z.infer<typeof EvaluationCaseArchiveInput>;
