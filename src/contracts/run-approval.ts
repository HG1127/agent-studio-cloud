import { z } from "zod";
import { ApprovalDecisionInput, ApprovalDecisionResult, ApprovalView, RunStatus } from "./run";
import { RunTaskReference } from "./run-task";

export const MAX_RUN_APPROVAL_DECISION_BYTES = 4096;
export const RunApprovalReference = RunTaskReference.extend({ approvalId: z.string().uuid().transform((value) => value.toLowerCase()) }).strict();
export type RunApprovalReference = z.infer<typeof RunApprovalReference>;
export const RunApprovalDecisionBody = ApprovalDecisionInput.omit({ resumeOnly: true }).extend({ confirmed: z.literal(true) }).strict();
export type RunApprovalDecisionBody = z.infer<typeof RunApprovalDecisionBody>;
export const RunApprovalDecisionInput = RunApprovalDecisionBody.extend(RunApprovalReference.shape).strict();
export type RunApprovalDecisionInput = z.infer<typeof RunApprovalDecisionInput>;
export const RunApprovalDecisionResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), ...RunApprovalReference.shape, decision: ApprovalDecisionInput.shape.decision, recorded: z.literal(true) }).strict(),
  ApprovalDecisionResult.options[1],
]);
export type RunApprovalDecisionResult = z.infer<typeof RunApprovalDecisionResult>;
export const RunApprovalState = z.enum(["pending", "resume-needed", "processed", "unavailable"]);
export type RunApprovalState = z.infer<typeof RunApprovalState>;
export const RunApprovalDetail = ApprovalView.extend({
  nodeId: z.string().max(200), nodeTitle: z.string().max(500), role: z.string().max(1000), reason: z.string().max(4000),
  note: z.string().max(2000).nullable(), runStatus: RunStatus, state: RunApprovalState,
  decisionConsumed: z.boolean(), createdAt: z.string().datetime(),
});
export type RunApprovalDetail = z.infer<typeof RunApprovalDetail>;
export const RunApprovalGetResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), approval: RunApprovalDetail }),
  ApprovalDecisionResult.options[1],
]);
export type RunApprovalGetResult = z.infer<typeof RunApprovalGetResult>;
export const RunApprovalCursor = z.object({ createdAt: z.string().datetime(), id: z.string().uuid() }).strict();
export type RunApprovalCursor = z.infer<typeof RunApprovalCursor>;
export const RunApprovalListInput = z.object({
  status: ApprovalView.shape.status.optional(), limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().datetime().optional(), beforeId: z.string().uuid().transform((value) => value.toLowerCase()).optional(),
}).strict().superRefine((input, context) => {
  if ((input.before === undefined) !== (input.beforeId === undefined)) context.addIssue({ code: "custom", message: "翻页时间与标识必须同时提供" });
});
export type RunApprovalListInput = z.infer<typeof RunApprovalListInput>;
export const RunApprovalSummary = RunApprovalDetail.pick({ id: true, runId: true, nodeTitle: true, status: true, runStatus: true, state: true, decisionConsumed: true, createdAt: true, decidedAt: true }).extend({ titleTruncated: z.boolean() });
export type RunApprovalSummary = z.infer<typeof RunApprovalSummary>;
export const RunApprovalListResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), runId: RunTaskReference.shape.runId, items: z.array(RunApprovalSummary).max(50), nextCursor: RunApprovalCursor.nullable() })
    .refine((result) => result.items.every((item) => item.runId === result.runId), "确认列表必须属于同一次任务"),
  ApprovalDecisionResult.options[1],
]);
export type RunApprovalListResult = z.infer<typeof RunApprovalListResult>;
