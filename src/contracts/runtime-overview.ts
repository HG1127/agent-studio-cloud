import { z } from "zod";
import { RunSourceType } from "./run";
import { AttentionIdentifier } from "./attention-reference";
import { MAX_OPERATIONAL_EPOCH_MS, MIN_OPERATIONAL_EPOCH_MS } from "./wait-timing";

export const RuntimeOverviewWindow = z.enum(["1h", "24h", "7d", "30d"]);
export type RuntimeOverviewWindow = z.infer<typeof RuntimeOverviewWindow>;
export const RuntimeOverviewInput = z.object({ window: RuntimeOverviewWindow.default("24h"), agentId: AttentionIdentifier.optional(), sourceType: RunSourceType.optional() }).strict();
export type RuntimeOverviewInput = z.infer<typeof RuntimeOverviewInput>;
export const RUNTIME_OVERVIEW_WINDOW_MS = { "1h": 3600000, "24h": 86400000, "7d": 7 * 86400000, "30d": 30 * 86400000 } as const;
const Timestamp = z.string().datetime().max(32).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.[0-9]{1,6})?Z$/, "运行时间最多保留微秒");
export const RuntimeOverviewBounds = z.object({ from: Timestamp, until: Timestamp }).strict().refine((value) => {
  const from = Date.parse(value.from), until = Date.parse(value.until);
  return from >= MIN_OPERATIONAL_EPOCH_MS && until <= MAX_OPERATIONAL_EPOCH_MS && from < until && until - from <= 30 * 86400000;
}, "运行统计时间窗口不正确");
export type RuntimeOverviewBounds = z.infer<typeof RuntimeOverviewBounds>;
const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const RawCount = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(Count);
function epochMicroseconds(value: string): bigint | null {
  const [base, fraction = ""] = value.replace(/Z$/, "").split(".");
  const ms = Date.parse(`${base}Z`);
  return Number.isFinite(ms) && /^[0-9]{0,6}$/.test(fraction) ? BigInt(ms) * BigInt(1000) + BigInt((fraction + "000000").slice(0, 6)) : null;
}
const Duration = z.number().finite().nonnegative().max(MAX_OPERATIONAL_EPOCH_MS - MIN_OPERATIONAL_EPOCH_MS);
const RawDuration = z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/).transform(Number).pipe(Duration).nullable();
export const RuntimeOverviewAggregate = z.object({
  queued: RawCount, running: RawCount, waitingApproval: RawCount, waitingEvent: RawCount,
  oldestQueuedReceivedAt: Timestamp.nullable(), oldestQueuedReceivedAgeSeconds: RawCount.nullable(), queuedTimeUnknown: RawCount, activeWithEndTime: RawCount,
  received: RawCount, receivedUnknownStatus: RawCount, manual: RawCount, schedule: RawCount, agentCall: RawCount, handoff: RawCount, evaluation: RawCount, unknownSource: RawCount,
  completed: RawCount, failed: RawCount, cancelled: RawCount, knownDuration: RawCount, unknownDuration: RawCount, meanDurationMs: RawDuration, p95DurationMs: RawDuration,
}).strict();
export type RuntimeOverviewAggregate = z.infer<typeof RuntimeOverviewAggregate>;
export const RuntimeOverview = z.object({
  assessedAt: Timestamp, bounds: RuntimeOverviewBounds,
  filters: RuntimeOverviewInput.extend({ window: RuntimeOverviewWindow, agentId: AttentionIdentifier.nullable(), sourceType: RunSourceType.nullable() }),
  active: z.object({ queued: Count, running: Count, waitingApproval: Count, waitingEvent: Count, total: Count,
    oldestQueuedReceivedAt: Timestamp.nullable(), oldestQueuedReceivedAgeSeconds: Count.nullable(), queuedTimeUnknown: Count, activeWithEndTime: Count }).strict(),
  received: z.object({ total: Count, unknownStatus: Count, bySource: z.object({ manual: Count, schedule: Count, agentCall: Count, handoff: Count, evaluation: Count, unknown: Count }).strict() }).strict(),
  finished: z.object({ completed: Count, failed: Count, cancelled: Count, total: Count, failureRatePercent: z.number().min(0).max(100).nullable(),
    knownDurationCount: Count, unknownDurationCount: Count, meanDurationMs: Duration.nullable(), p95DurationMs: Duration.nullable() }).strict(),
}).strict().superRefine((value, ctx) => {
  const active = value.active, finished = value.finished, received = value.received;
  if (value.assessedAt !== value.bounds.until || Date.parse(value.bounds.until) - Date.parse(value.bounds.from) !== RUNTIME_OVERVIEW_WINDOW_MS[value.filters.window]
    || active.total !== active.queued + active.running + active.waitingApproval + active.waitingEvent
    || active.queuedTimeUnknown > active.queued || active.activeWithEndTime > active.total
    || received.total !== Object.values(received.bySource).reduce((total, count) => total + count, 0) || received.unknownStatus > received.total
    || finished.total !== finished.completed + finished.failed + finished.cancelled || finished.total !== finished.knownDurationCount + finished.unknownDurationCount
    || (finished.completed + finished.failed === 0) !== (finished.failureRatePercent === null)
    || (finished.knownDurationCount === 0) !== (finished.meanDurationMs === null) || (finished.meanDurationMs === null) !== (finished.p95DurationMs === null)
    || (active.oldestQueuedReceivedAt === null) !== (active.oldestQueuedReceivedAgeSeconds === null)
    || (active.queued === active.queuedTimeUnknown) !== (active.oldestQueuedReceivedAt === null)) ctx.addIssue({ code: "custom", message: "运行统计口径与计数或时间不一致" });
  if (active.oldestQueuedReceivedAt !== null) {
    const receivedAt = epochMicroseconds(active.oldestQueuedReceivedAt), assessedAt = epochMicroseconds(value.assessedAt);
    if (receivedAt === null || assessedAt === null || receivedAt > assessedAt || Number((assessedAt - receivedAt) / BigInt(1000000)) !== active.oldestQueuedReceivedAgeSeconds) ctx.addIssue({ code: "custom", message: "排队接收年龄与时间不一致" });
  }
  if (finished.failureRatePercent !== null && finished.failureRatePercent !== Math.round(finished.failed / (finished.completed + finished.failed) * 10000) / 100) ctx.addIssue({ code: "custom", message: "失败率必须按成功与失败结束任务计算" });
});
export type RuntimeOverview = z.infer<typeof RuntimeOverview>;
export const RuntimeOverviewResult = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), summary: RuntimeOverview }).strict(), z.object({ ok: z.literal(false), error: z.string().min(1).max(2000), retryable: z.literal(true).optional() }).strict()]);
export type RuntimeOverviewResult = z.infer<typeof RuntimeOverviewResult>;
