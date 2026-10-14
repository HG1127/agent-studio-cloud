"use server";
import { RunDeliveryTickResult } from "@/contracts/run-delivery";
import { dispatchPendingDeliveriesCore } from "@/server/services/dispatch-run-deliveries";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export async function dispatchRunDeliveriesAction(authorization: string | null): Promise<RunDeliveryTickResult> {
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) return { ok: false, error: "未授权的调用" };
  try { return RunDeliveryTickResult.parse({ ok: true, ...await dispatchPendingDeliveriesCore() }); }
  catch (error) {
    console.error("投递调度暂时失败", safeErrorForLog(error));
    return { ok: false, error: "投递检查暂时失败，请稍后重试", retryable: true };
  }
}
