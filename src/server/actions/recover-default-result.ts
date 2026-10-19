"use server";
import { getRun, resumeHook } from "workflow/api";
import { FatalError } from "workflow";
import { RecoverDefaultResultInput, RecoverDefaultResultResult, type RecoverDefaultResultResult as RecoveryResult } from "@/contracts/default-result-delivery";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { defaultResultDeliveryHookToken, defaultResultDeliveryView, defaultResultWorkflowNotificationPending } from "@/server/domain/runtime/default-result-delivery";
import { deliverDefaultResult, readDefaultResultDelivery } from "@/server/services/default-result-delivery";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

async function readNotificationRunStatus(sdkRunId: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = getRun(sdkRunId);
    if (run.runId !== sdkRunId) return null;
    return await Promise.race([
      run.status,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 2_000); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function recoverDefaultResultAction(input: RecoverDefaultResultInput): Promise<RecoveryResult> {
  const parsed = RecoverDefaultResultInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "成果核对请求无效" };
  try {
    const existing = await readDefaultResultDelivery(parsed.data.runId, DEMO_WORKSPACE_ID);
    if (!existing) return { ok: false, error: "没有可访问的主流程成果投递记录" };
    if (existing.runId !== parsed.data.runId || existing.workspaceId !== DEMO_WORKSPACE_ID) throw new FatalError("成果归属不匹配");
    await deliverDefaultResult(existing.runId, DEMO_WORKSPACE_ID, parsed.data.mode === "verify");
    const record = await readDefaultResultDelivery(existing.runId, DEMO_WORKSPACE_ID);
    if (!record) return { ok: false, error: "成果投递记录不存在或不可访问" };
    if (record.runId !== parsed.data.runId || record.workspaceId !== DEMO_WORKSPACE_ID) throw new FatalError("成果归属不匹配");
    let workflowNotified = false;
    let workflowNotificationPending = false;
    if (record.waitingHookToken && (record.status === "confirmed" || record.status === "failed")) {
      try {
        await resumeHook(defaultResultDeliveryHookToken(record), { kind: "delivery-updated" });
        workflowNotified = true;
      } catch {
        workflowNotificationPending = defaultResultWorkflowNotificationPending(record, await readNotificationRunStatus(record.sdkRunId));
      }
    }
    return RecoverDefaultResultResult.parse({
      ok: true, delivery: defaultResultDeliveryView(record), workflowNotified,
      ...(workflowNotificationPending ? { workflowNotificationPending: true } : {}),
    });
  } catch (error) {
    console.error("成果核对未完成", safeErrorForLog(error));
    return FatalError.is(error)
      ? { ok: false, error: "成果归属或保存状态未通过校验，不能再次发送", retryable: false }
      : { ok: false, error: "成果核对暂时无法确认，请稍后重试；不能重新运行模型或工具", retryable: true };
  }
}
