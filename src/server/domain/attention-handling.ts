import type { AttentionReference } from "@/contracts/attention-reference";
import type { AttentionHandlingInput, AttentionHandlingStatus, AttentionSourceState } from "@/contracts/attention-handling";

export function attentionSourceState(reference: AttentionReference, current: AttentionReference | null): AttentionSourceState {
  if (!current) return "inactive";
  return reference.kind === current.kind && reference.id === current.id && reference.runId === current.runId && reference.occurrence === current.occurrence ? "active" : "changed";
}
export function attentionHandlingTransition(status: AttentionHandlingStatus, action: AttentionHandlingInput, sourceState: ReturnType<typeof attentionSourceState>, hasUnresolvedBusiness = false, originalResolved = true): { ok: true; status: AttentionHandlingStatus } | { ok: false; error: string } {
  if (action.action === "close-resolved") return sourceState !== "active" && originalResolved ? { ok: true, status: "closed" } : { ok: false, error: "原事项仍待处理，请先在原入口完成确认、核对或补投" };
  if (action.action === "accept-failure" && hasUnresolvedBusiness) return { ok: false, error: "仍有未确认的业务操作，请先核对原回执，不可直接接受失败关闭" };
  if (action.action === "accept-failure") return action.reference.kind === "run-failed" && sourceState === "active" ? { ok: true, status: "closed" } : { ok: false, error: "只有已核对且决定不再重试的失败任务可以接受失败并关闭跟踪" };
  if (action.action === "note") return { ok: true, status };
  if (sourceState !== "active") return { ok: false, error: "原事项已结束或发生变化，请刷新当前待处理清单" };
  if (action.action === "reopen") return status === "closed" ? { ok: true, status: "in-progress" } : { ok: false, error: "只有已关闭的跟踪记录可以重新打开" };
  return status !== "closed" ? { ok: true, status: "in-progress" } : { ok: false, error: "此跟踪已关闭，请明确重新打开后再处理" };
}
