import { z } from "zod";
import { RunTaskResultView } from "./run-task";
import { MAX_RUN_RESULT_BYTES } from "./run";

export const MAX_RUN_DELIVERY_BYTES = MAX_RUN_RESULT_BYTES + 128 * 1024;
import { RunDeliveryTargetId } from "./run-delivery-config";
export * from "./run-delivery-config";
export const RunDeliveryStatus = z.enum(["waiting_result", "pending", "queued", "sending", "delivered", "failed"]);
export type RunDeliveryStatus = z.infer<typeof RunDeliveryStatus>;
export const RunDeliveryEnvelope = z.object({
  schemaVersion: z.literal(1), deliveryId: z.string().uuid(),
  task: RunTaskResultView.refine((task) => task.ready, "只允许投递已结束任务"),
}).strict().refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_RUN_DELIVERY_BYTES, "投递成果超过容量限制");
export type RunDeliveryEnvelope = z.infer<typeof RunDeliveryEnvelope>;
export const RunDeliveryReceipt = z.object({ ok: z.literal(true), deliveryId: z.string().uuid(), receiptId: z.string().trim().min(1).max(200).optional() }).strict();
export type RunDeliveryReceipt = z.infer<typeof RunDeliveryReceipt>;
export const RunDeliveryRetryBody = z.object({
  requestId: z.string().uuid().transform((value) => value.toLowerCase()), confirmed: z.literal(true),
  reason: z.string().trim().min(1).max(500),
}).strict();
export type RunDeliveryRetryBody = z.infer<typeof RunDeliveryRetryBody>;
export const RunDeliveryResolution = z.object({
  requestId: z.string().uuid(), requestHash: z.string().regex(/^[0-9a-f]{64}$/), reason: z.string().max(2000),
  createdBy: z.string().uuid(), createdAt: z.iso.datetime(),
}).strict();
export type RunDeliveryResolution = z.infer<typeof RunDeliveryResolution>;
export const RunDeliveryView = z.object({
  id: z.string().uuid(), runId: z.string().uuid(), targetId: RunDeliveryTargetId, status: RunDeliveryStatus,
  attempts: z.number().int().min(0).max(105), maxAttempts: z.number().int().min(5).max(105),
  error: z.string().max(2000).nullable(), receipt: RunDeliveryReceipt.nullable(),
  nextAttemptAt: z.iso.datetime().nullable(), retryDeadline: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  resolutions: z.array(RunDeliveryResolution).max(20),
}).strict().superRefine((value, context) => {
  if (value.attempts > value.maxAttempts || (value.status === "delivered" && (!value.receipt || !value.deliveredAt))
    || (value.receipt && value.receipt.deliveryId !== value.id)) context.addIssue({ code: "custom", message: "投递回执或次数与记录不一致" });
});
export type RunDeliveryView = z.infer<typeof RunDeliveryView>;
export const RunDeliveryResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), runId: z.string().uuid(), delivery: RunDeliveryView.nullable() }).strict(),
  z.object({ ok: z.literal(false), error: z.string(), retryable: z.literal(true).optional() }).strict(),
]).superRefine((value, context) => {
  if (value.ok && value.delivery && value.delivery.runId !== value.runId) context.addIssue({ code: "custom", message: "投递记录不属于本次任务" });
});
export type RunDeliveryResult = z.infer<typeof RunDeliveryResult>;
export const RunDeliveryRetryResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), runId: z.string().uuid(), deliveryId: z.string().uuid(), recorded: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), error: z.string(), retryable: z.literal(true).optional() }).strict(),
]);
export type RunDeliveryRetryResult = z.infer<typeof RunDeliveryRetryResult>;
export const RunDeliveryTickResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), materialized: z.number().int().nonnegative(), claimed: z.number().int().nonnegative() }).strict(),
  z.object({ ok: z.literal(false), error: z.string(), retryable: z.literal(true).optional() }).strict(),
]);
export type RunDeliveryTickResult = z.infer<typeof RunDeliveryTickResult>;
