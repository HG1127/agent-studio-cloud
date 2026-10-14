import { WaitTimingSnapshot } from "@/contracts/wait-timing";
import type { WorkflowNode } from "@/contracts/workflow";

export function createWaitTiming(wait: NonNullable<WorkflowNode["wait"]>, now: Date): WaitTimingSnapshot {
  const current = now.getTime();
  if (!Number.isFinite(current)) throw new Error("等待时间起点无效");
  const duration = wait.mode === "delay" ? wait.durationMs : wait.timeoutMs;
  if (wait.mode !== "until" && (!Number.isFinite(duration) || duration < 0)) throw new Error("等待时长无效");
  const expectedAtMs = wait.mode === "until" ? Date.parse(wait.until ?? "")
    : wait.mode === "event" && duration === 0 ? null : Math.trunc(current + duration);
  return WaitTimingSnapshot.parse({ mode: wait.mode, expectedAtMs });
}
