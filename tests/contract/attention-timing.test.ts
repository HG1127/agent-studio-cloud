import { describe, expect, it } from "vitest";
import { AttentionListInput } from "@/contracts/attention";
import { AttentionTiming, AttentionTimingSource, AttentionTimingState } from "@/contracts/attention-timing";
import { WaitTimingSnapshot } from "@/contracts/wait-timing";
describe("时效共享契约", () => {
  it.each(AttentionTimingState.options)("允许按 %s 有界筛选", (timingState) => { expect(AttentionListInput.parse({ timingState })).toEqual({ timingState, limit: 20 }); });
  it("未知筛选、假定时截止、额外凭据和坏时间拒绝", () => {
    expect(AttentionListInput.safeParse({ timingState: "timeout" }).success).toBe(false);
    expect(WaitTimingSnapshot.safeParse({ mode: "delay", expectedAtMs: null }).success).toBe(false);
    expect(AttentionTimingSource.safeParse({ waitMode: "event", sinceEpochMs: null, expectedEpochMs: null, retryEpochMs: null, hookToken: "hidden" }).success).toBe(false);
    expect(AttentionTiming.safeParse({ waitMode: "event", state: "normal", sinceAt: "bad", expectedAt: null, retryDeadline: null, assessedAt: "bad", elapsedSeconds: -1 }).success).toBe(false);
  });
});
