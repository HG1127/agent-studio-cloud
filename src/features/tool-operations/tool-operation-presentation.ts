import {
  MAX_TOOL_OPERATION_RECEIPT_BYTES, ToolOperationResolveInput, ToolOperationView,
  type ToolOperationStatus,
} from "@/contracts/tool-operation";
import { redactSensitiveData, redactSensitiveText } from "@/server/domain/security/redact-sensitive";

export const operationStatusLabels: Record<ToolOperationStatus, string> = {
  pending: "尚未确认完成", completed: "已确认完成", blocked: "结果待人工核对",
};

export function operationText(value: string, operation?: Pick<ToolOperationView, "id" | "sourceRunId" | "toolId">): string {
  let text = redactSensitiveText(value).replace(/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}/gi, "[内部标识已隐藏]");
  if (operation) for (const id of [operation.id, operation.sourceRunId, operation.toolId]) if (id) text = text.split(id).join("[内部标识已隐藏]");
  return text;
}

export function operationReceiptText(operation: ToolOperationView): string {
  return operationText(JSON.stringify(redactSensitiveData(operation.receipt), null, 2), operation);
}

export function operationDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export function createToolOperationResolution(operation: ToolOperationView, kind: ToolOperationResolveInput["kind"], reason: string, receiptText: string, confirmed: boolean, requestId: string): ToolOperationResolveInput {
  const current = ToolOperationView.safeParse(operation);
  if (!current.success || current.data.status === "completed") throw new Error("当前记录不能再填写核对结论，请重新读取。");
  if (!confirmed) throw new Error("请先明确确认业务系统的实际状态。");
  if (reason.trim().length < 5 || reason.trim().length > 500) throw new Error("核对依据须填写五到五百个字。");
  if (kind === "retry" && Date.parse(operation.retryDeadline) <= Date.now()) throw new Error("允许重新尝试的期限已过，请核对实际回执。");
  let receipt: unknown;
  if (kind === "record-receipt") {
    if (receiptText.length > MAX_TOOL_OPERATION_RECEIPT_BYTES) throw new Error("实际回执超过大小限制。");
    try { receipt = JSON.parse(receiptText); } catch { throw new Error("实际回执须填写有效的对象格式。"); }
  }
  const result = ToolOperationResolveInput.safeParse(kind === "retry"
    ? { operationId: operation.id, requestId, kind, reason, confirmedNotExecuted: true }
    : { operationId: operation.id, requestId, kind, reason, confirmedCompleted: true, receipt });
  if (!result.success) throw new Error("实际回执或核对信息不符合要求，请检查内容、大小和层级。");
  return result.data;
}
