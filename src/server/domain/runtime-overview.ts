import { RuntimeOverview, RuntimeOverviewBounds, RuntimeOverviewInput, RUNTIME_OVERVIEW_WINDOW_MS, type RuntimeOverviewAggregate } from "@/contracts/runtime-overview";

export function runtimeOverviewBounds(window: RuntimeOverviewInput["window"], now: Date): RuntimeOverviewBounds {
  return RuntimeOverviewBounds.parse({ from: new Date(now.getTime() - RUNTIME_OVERVIEW_WINDOW_MS[window]).toISOString(), until: now.toISOString() });
}
export function presentRuntimeOverview(input: RuntimeOverviewInput, bounds: RuntimeOverviewBounds, row: RuntimeOverviewAggregate): RuntimeOverview {
  const activeTotal = row.queued + row.running + row.waitingApproval + row.waitingEvent;
  const evaluated = row.completed + row.failed;
  return RuntimeOverview.parse({ assessedAt: bounds.until, bounds, filters: { ...input, agentId: input.agentId ?? null, sourceType: input.sourceType ?? null },
    active: { queued: row.queued, running: row.running, waitingApproval: row.waitingApproval, waitingEvent: row.waitingEvent, total: activeTotal,
      oldestQueuedReceivedAt: row.oldestQueuedReceivedAt, oldestQueuedReceivedAgeSeconds: row.oldestQueuedReceivedAgeSeconds,
      queuedTimeUnknown: row.queuedTimeUnknown, activeWithEndTime: row.activeWithEndTime },
    received: { total: row.received, unknownStatus: row.receivedUnknownStatus, bySource: { manual: row.manual, schedule: row.schedule, agentCall: row.agentCall, handoff: row.handoff, evaluation: row.evaluation, unknown: row.unknownSource } },
    finished: { completed: row.completed, failed: row.failed, cancelled: row.cancelled, total: evaluated + row.cancelled, failureRatePercent: evaluated ? Math.round(row.failed / evaluated * 10000) / 100 : null,
      knownDurationCount: row.knownDuration, unknownDurationCount: row.unknownDuration, meanDurationMs: row.meanDurationMs, p95DurationMs: row.p95DurationMs },
  });
}
