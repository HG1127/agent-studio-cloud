"use step";
import { FatalError, RetryableError } from "workflow";
import { attemptRunDeliveryCore } from "@/server/services/run-delivery";
import { withSafeWorkflowError } from "@/server/security/workflow-error";

export async function attemptRunDelivery(id: string, workspaceId: string, token: string) {
  "use step";
  const result = await withSafeWorkflowError(() => attemptRunDeliveryCore(id, workspaceId, token), "投递状态暂时无法确认，等待恢复");
  if (result.kind === "retry") throw new RetryableError(result.error, { retryAfter: Math.min(120_000, result.after) });
  if (result.kind === "fatal") throw new FatalError(result.error);
  return result.kind;
}
attemptRunDelivery.maxRetries = 7;
