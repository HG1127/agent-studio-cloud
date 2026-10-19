import { z } from "zod";
import { FrozenDefaultResultFrame, MAX_DEFAULT_RESULT_SEND_ATTEMPTS } from "./default-result-stream";
import { RunSourceType, RunStatus } from "./run";

export const DEFAULT_RESULT_TRACKING_VERSION = "sdk5-v1";
export const MAX_DEFAULT_RESULT_RECOVERY_REQUEST_BYTES = 4096;
export const DefaultResultDeliveryStatus = z.enum(["ready", "sending", "waiting_review", "confirmed", "failed"]);
export type DefaultResultDeliveryStatus = z.infer<typeof DefaultResultDeliveryStatus>;
export const DefaultResultDeliveryOperation = z.enum(["write", "close"]);
export type DefaultResultDeliveryOperation = z.infer<typeof DefaultResultDeliveryOperation>;
export const DefaultResultDeliveryAcknowledgement = z.enum(["none", "unknown", "confirmed"]);
export type DefaultResultDeliveryAcknowledgement = z.infer<typeof DefaultResultDeliveryAcknowledgement>;

export const DefaultResultCompletionSource = z.object({
  runId: z.string().uuid(), workspaceId: z.string().uuid(), createdBy: z.string().uuid(),
  parentRunId: z.string().uuid().nullable(), sourceType: RunSourceType,
  sdkRunId: z.string().min(1).max(200).nullable(), trackingVersion: z.string().nullable(),
}).strict();
export type DefaultResultCompletionSource = z.infer<typeof DefaultResultCompletionSource>;

export const RunCompletionOutcome = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("completed"), runId: z.string().uuid(), deliveryRequired: z.boolean() }).strict(),
  z.object({ kind: z.literal("stopped"), runId: z.string().uuid(), status: RunStatus.extract(["failed", "cancelled"]) }).strict(),
]);
export type RunCompletionOutcome = z.infer<typeof RunCompletionOutcome>;

const DefaultResultDeliveryRecordFields = z.object({
  runId: z.string().uuid(), workspaceId: z.string().uuid(), createdBy: z.string().uuid(),
  sdkRunId: z.string().min(1).max(200), frozen: FrozenDefaultResultFrame,
  status: DefaultResultDeliveryStatus,
  writeAttempts: z.number().int().min(0).max(MAX_DEFAULT_RESULT_SEND_ATTEMPTS),
  operation: DefaultResultDeliveryOperation.nullable(), operationToken: z.string().min(1).max(200).nullable(),
  waitingHookToken: z.string().min(1).max(250).nullable(),
  waitingHookStepId: z.string().min(1).max(200).nullable(),
  acknowledgement: DefaultResultDeliveryAcknowledgement, producerSettled: z.boolean(),
  error: z.string().max(1000).nullable(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), confirmedAt: z.iso.datetime().nullable(),
}).strict();
export const DefaultResultDeliveryRecord = DefaultResultDeliveryRecordFields.superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if ((value.operation === null) !== (value.operationToken === null)) issue("成果发送操作与凭据必须同时存在");
  if ((value.waitingHookToken === null) !== (value.waitingHookStepId === null)) issue("成果等待入口与步骤身份必须同时存在");
  if (value.status === "sending" && (value.producerSettled || value.acknowledgement !== "unknown" || !value.operationToken)) issue("发送中不能虚报发送已结束");
  if (!value.producerSettled && value.operation === "write" && value.writeAttempts < 1) issue("未确认的成果写入必须记录尝试次数");
  if (!value.producerSettled && (value.acknowledgement !== "unknown" || !["sending", "waiting_review"].includes(value.status) || !value.operationToken)) issue("未确认结束的发送只能等待核对");
  if (value.status === "ready" && (!value.producerSettled || value.acknowledgement !== "none")) issue("可发送状态必须确认前次没有发送");
  if (value.status === "confirmed" && (!value.producerSettled || value.acknowledgement !== "confirmed" || !value.confirmedAt)) issue("已送达必须有可信读回确认");
  if (value.status === "failed" && !value.producerSettled) issue("发送未结束时不能关闭流程");
});
export type DefaultResultDeliveryRecord = z.infer<typeof DefaultResultDeliveryRecord>;

export const DefaultResultDeliveryView = DefaultResultDeliveryRecordFields.pick({
  runId: true, status: true, writeAttempts: true, error: true, createdAt: true, updatedAt: true, confirmedAt: true,
}).extend({
  canRetry: z.boolean(), canVerify: z.boolean(),
});
export type DefaultResultDeliveryView = z.infer<typeof DefaultResultDeliveryView>;
export const DefaultResultDeliveryInput = z.object({ runId: z.string().uuid() }).strict();
export type DefaultResultDeliveryInput = z.infer<typeof DefaultResultDeliveryInput>;
export const DefaultResultDeliveryWake = z.object({ kind: z.literal("delivery-updated") }).strict();
export type DefaultResultDeliveryWake = z.infer<typeof DefaultResultDeliveryWake>;
export const DefaultResultDeliveryStepResult = z.object({
  status: DefaultResultDeliveryStatus, hookToken: z.string().min(1).max(250),
}).strict();
export type DefaultResultDeliveryStepResult = z.infer<typeof DefaultResultDeliveryStepResult>;

export const RecoverDefaultResultBody = z.object({ mode: z.enum(["verify", "retry"]) }).strict();
export type RecoverDefaultResultBody = z.infer<typeof RecoverDefaultResultBody>;
export const RecoverDefaultResultInput = DefaultResultDeliveryInput.extend(RecoverDefaultResultBody.shape).strict();
export type RecoverDefaultResultInput = z.infer<typeof RecoverDefaultResultInput>;
export const RecoverDefaultResultResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true), delivery: DefaultResultDeliveryView, workflowNotified: z.boolean(),
    workflowNotificationPending: z.literal(true).optional(),
  }).strict().superRefine((value, context) => {
    if (value.workflowNotificationPending && (value.workflowNotified || value.delivery.canRetry
      || !value.delivery.canVerify || !["confirmed", "failed"].includes(value.delivery.status))) {
      context.addIssue({ code: "custom", message: "待恢复通知必须保留成果终态，只允许继续核对" });
    }
  }),
  z.object({ ok: z.literal(false), error: z.string(), retryable: z.boolean().optional() }).strict(),
]);
export type RecoverDefaultResultResult = z.infer<typeof RecoverDefaultResultResult>;
export const DefaultResultDeliveryQueryResult = z.object({ delivery: DefaultResultDeliveryView.nullable() }).strict();
export type DefaultResultDeliveryQueryResult = z.infer<typeof DefaultResultDeliveryQueryResult>;
