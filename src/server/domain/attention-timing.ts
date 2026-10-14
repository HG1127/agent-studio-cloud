import { ATTENTION_EXPECTED_GRACE_MS, ATTENTION_LONG_PENDING_MS, AttentionTiming, AttentionTimingSource } from "@/contracts/attention-timing";
import { MAX_OPERATIONAL_EPOCH_MS, MIN_OPERATIONAL_EPOCH_MS } from "@/contracts/wait-timing";

function supportedEpoch(value: number | null): number | null {
  return value !== null && value >= MIN_OPERATIONAL_EPOCH_MS && value <= MAX_OPERATIONAL_EPOCH_MS ? value : null;
}

export function assessAttentionTiming(input: AttentionTimingSource, now: Date): AttentionTiming {
  const source = AttentionTimingSource.parse(input);
  const current = now.getTime();
  if (supportedEpoch(current) === null) throw new Error("待处理检查时间无效");
  const since = supportedEpoch(source.sinceEpochMs);
  const expected = source.waitMode === "unknown" ? null : supportedEpoch(source.expectedEpochMs);
  const retry = supportedEpoch(source.retryEpochMs);
  const trustedSince = since !== null && since <= current;
  const state = retry !== null && retry <= current ? "retry-expired"
    : expected !== null && expected + ATTENTION_EXPECTED_GRACE_MS <= current ? "expected-overdue"
    : trustedSince && !["timer", "unknown"].includes(source.waitMode) && since + ATTENTION_LONG_PENDING_MS <= current ? "long-pending"
    : !trustedSince || source.waitMode === "unknown" || (source.waitMode === "timer" && expected === null) ? "unknown" : "normal";
  return AttentionTiming.parse({ waitMode: source.waitMode, state,
    sinceAt: trustedSince ? new Date(since).toISOString() : null,
    expectedAt: expected === null ? null : new Date(expected).toISOString(),
    retryDeadline: retry === null ? null : new Date(retry).toISOString(), assessedAt: now.toISOString(),
    elapsedSeconds: trustedSince ? Math.floor((current - since) / 1000) : null,
  });
}
