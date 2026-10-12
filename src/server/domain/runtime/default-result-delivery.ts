import {
  DEFAULT_RESULT_TRACKING_VERSION, DefaultResultCompletionSource, DefaultResultDeliveryRecord, DefaultResultDeliveryView,
  DefaultResultDeliveryAcknowledgement, DefaultResultDeliveryOperation,
} from "@/contracts/default-result-delivery";
import type { DefaultResultStreamOwner } from "@/contracts/default-result-stream";
import { MAX_DEFAULT_RESULT_SEND_ATTEMPTS } from "@/contracts/default-result-stream";
import { classifyDefaultResultFrame } from "./default-result-stream";

export function requiresDefaultResultDelivery(value: DefaultResultCompletionSource): boolean {
  const source = DefaultResultCompletionSource.parse(value);
  if (source.parentRunId !== null || !["manual", "schedule", "evaluation"].includes(source.sourceType)) return false;
  if (source.trackingVersion !== DEFAULT_RESULT_TRACKING_VERSION) return false;
  if (!source.sdkRunId) throw new Error("主流程缺少执行身份，不能冻结成果投递");
  return true;
}

export function defaultResultDeliveryOwner(value: DefaultResultDeliveryRecord): DefaultResultStreamOwner {
  const record = DefaultResultDeliveryRecord.parse(value);
  if (record.frozen.frame.runId !== record.runId || classifyDefaultResultFrame(record.frozen, record.frozen.frame) !== "match") {
    throw new Error("冻结成果校验失败，不能投递");
  }
  return {
    workspaceId: record.workspaceId, runId: record.runId, sdkRunId: record.sdkRunId,
    root: true, frameHash: record.frozen.frameHash,
  };
}

export function defaultResultDeliveryHookToken(record: DefaultResultDeliveryRecord): string {
  defaultResultDeliveryOwner(record);
  return record.waitingHookToken ?? "default-result:" + record.runId + ":" + record.frozen.frameHash;
}

export function canClaimDefaultResultOperation(record: DefaultResultDeliveryRecord, operation: DefaultResultDeliveryOperation): boolean {
  DefaultResultDeliveryRecord.parse(record);
  DefaultResultDeliveryOperation.parse(operation);
  return record.producerSettled
    && !["sending", "confirmed", "failed"].includes(record.status)
    && (operation !== "write" || record.writeAttempts < MAX_DEFAULT_RESULT_SEND_ATTEMPTS);
}

export function settledDefaultResultOperation(args: {
  record: DefaultResultDeliveryRecord; operation: DefaultResultDeliveryOperation;
  acknowledgement: DefaultResultDeliveryAcknowledgement; confirmed: boolean; error: string | null;
}): Pick<DefaultResultDeliveryRecord, "status" | "acknowledgement" | "producerSettled" | "error" | "writeAttempts"> {
  const record = DefaultResultDeliveryRecord.parse(args.record);
  DefaultResultDeliveryOperation.parse(args.operation);
  DefaultResultDeliveryAcknowledgement.parse(args.acknowledgement);
  if (record.status !== "sending" || record.operation !== args.operation || !record.operationToken) {
    throw new Error("成果投递没有当前发送凭据，不能登记确认");
  }
  if (args.confirmed && args.acknowledgement !== "confirmed") throw new Error("成果确认缺少已确认的发送回执");
  if (args.acknowledgement === "unknown") {
    return { status: "waiting_review", acknowledgement: "unknown", producerSettled: false, error: args.error, writeAttempts: record.writeAttempts };
  }
  if (args.acknowledgement === "none") {
    return {
      status: "ready", acknowledgement: "none", producerSettled: true, error: args.error,
      writeAttempts: record.writeAttempts - Number(args.operation === "write"),
    };
  }
  return {
    status: args.confirmed ? "confirmed" : "waiting_review", acknowledgement: "confirmed",
    producerSettled: true, error: args.error, writeAttempts: record.writeAttempts,
  };
}

export function defaultResultDeliveryView(record: DefaultResultDeliveryRecord): DefaultResultDeliveryView {
  defaultResultDeliveryOwner(record);
  return DefaultResultDeliveryView.parse({
    runId: record.runId, status: record.status, writeAttempts: record.writeAttempts, error: record.error,
    createdAt: record.createdAt, updatedAt: record.updatedAt, confirmedAt: record.confirmedAt,
    canRetry: canClaimDefaultResultOperation(record, "write") || canClaimDefaultResultOperation(record, "close"),
    canVerify: !["confirmed", "failed"].includes(record.status),
  });
}
