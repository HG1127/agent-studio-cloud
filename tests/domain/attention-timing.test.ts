import { describe, expect, it } from "vitest";
import { ATTENTION_EXPECTED_GRACE_MS, ATTENTION_LONG_PENDING_MS, type AttentionTimingSource } from "@/contracts/attention-timing";
import { assessAttentionTiming } from "@/server/domain/attention-timing";
const now = new Date("2026-10-08T12:00:00Z");
const current = now.getTime();
const source: AttentionTimingSource = { waitMode: "event", sinceEpochMs: current - 1000, expectedEpochMs: null, retryEpochMs: null };
describe("可信待处理时效纯分类", () => {
  it("判断只使用传入时间并保留源记录", () => {
    const original = structuredClone(source);
    expect(assessAttentionTiming(source, now)).toMatchObject({ state: "normal", elapsedSeconds: 1, assessedAt: now.toISOString() });
    expect(source).toEqual(original);
  });
  it.each([[-ATTENTION_LONG_PENDING_MS + 1, "normal"], [-ATTENTION_LONG_PENDING_MS, "long-pending"]] as const)("持续 %s 毫秒分类 %s", (delta, state) => {
    expect(assessAttentionTiming({ ...source, sinceEpochMs: current + delta }, now).state).toBe(state);
  });
  it.each([[-ATTENTION_EXPECTED_GRACE_MS + 1, "normal"], [-ATTENTION_EXPECTED_GRACE_MS, "expected-overdue"]] as const)("预计时间 %s 毫秒分类 %s", (delta, state) => {
    expect(assessAttentionTiming({ ...source, expectedEpochMs: current + delta }, now).state).toBe(state);
  });
  it("未来正常定时等待即使超过24小时也不要求人工处理", () => {
    expect(assessAttentionTiming({ ...source, waitMode: "timer", sinceEpochMs: current - ATTENTION_LONG_PENDING_MS * 10, expectedEpochMs: current + 1000 }, now).state).toBe("normal");
  });
  it.each([null, current + 1, 8640000000000000])("不以缺失、未来或不支持的起点 %s 伪造时长", (sinceEpochMs) => {
    expect(assessAttentionTiming({ ...source, sinceEpochMs }, now)).toMatchObject({ state: "unknown", sinceAt: null, elapsedSeconds: null });
  });
  it("未知等待方式不猜测为外部消息或定时超期", () => {
    expect(assessAttentionTiming({ ...source, waitMode: "unknown", sinceEpochMs: current - ATTENTION_LONG_PENDING_MS * 2, expectedEpochMs: 0 }, now)).toMatchObject({ state: "unknown", expectedAt: null });
    expect(assessAttentionTiming({ ...source, waitMode: "timer" }, now).state).toBe("unknown");
  });
  it("有效期恰到边界即过期，优先于长等待与预计时间", () => {
    expect(assessAttentionTiming({ ...source, sinceEpochMs: 0, expectedEpochMs: 0, retryEpochMs: current }, now).state).toBe("retry-expired");
    expect(assessAttentionTiming({ ...source, retryEpochMs: current + 1 }, now).state).toBe("normal");
  });
  it("无效检查时间和非有限存储字段明确拒绝", () => {
    expect(() => assessAttentionTiming(source, new Date("bad"))).toThrow();
    expect(() => assessAttentionTiming({ ...source, sinceEpochMs: NaN }, now)).toThrow();
  });
});
