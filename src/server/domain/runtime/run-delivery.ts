import { RunDeliveryBinding, RUN_DELIVERY_INTENT_KEY, type RunDeliveryEnvelope } from "@/contracts/run-delivery";

export function runDeliveryIntentMatches(stepStates: Record<string, unknown>, targetId?: string): boolean {
  const raw = stepStates[RUN_DELIVERY_INTENT_KEY];
  if (raw === undefined) return targetId === undefined;
  const binding = RunDeliveryBinding.safeParse(raw);
  return binding.success && binding.data.targetId === targetId;
}
export function deliveryRetryDelay(attempt: number): number {
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, Math.min(4, attempt - 1)));
}
export function deliveryAttemptIssue(args: { attempts: number; maxAttempts: number; retryDeadline: Date | null }, now: Date): string | null {
  if (args.retryDeadline && args.retryDeadline.getTime() <= now.getTime()) return "接收方防重有效期已过，不能再次发送";
  if (args.attempts >= args.maxAttempts) return "自动投递次数已用完，请核对接收方后决定是否补投";
  return null;
}
export function deliveryEnvelopeMatches(envelope: RunDeliveryEnvelope, deliveryId: string, runId: string): boolean {
  return envelope.deliveryId === deliveryId && envelope.task.runId === runId && envelope.task.ready;
}
