import { DEFAULT_EXECUTION_RESOURCE_LIMITS, ExecutionPolicyRecord, ExecutionPolicySnapshot, ExecutionPolicyView, ExecutionResourceAdmission, ExecutionResourceCount, ExecutionResourceLimits, ExecutionResourceLimit, ExecutionResourceSnapshot, type ExecutionCapacityCounts } from "@/contracts/execution-resources";

export function presentExecutionPolicy(raw: unknown): ExecutionPolicyView {
  if (raw === null) return ExecutionPolicyView.parse({ revision: 0, source: "default", limits: DEFAULT_EXECUTION_RESOURCE_LIMITS, updatedAt: null });
  const row = ExecutionPolicyRecord.parse(raw);
  if (row.archivedAt !== null) throw new Error("资源设置已停用，不能跳过原限制");
  return ExecutionPolicyView.parse({ revision: row.revision, source: "configured", limits: row.limits, updatedAt: row.updatedAt.toISOString() });
}
export function freezeExecutionResources(policy: ExecutionPolicyView, coverage: ExecutionResourceSnapshot["coverage"], now = new Date()): ExecutionResourceSnapshot {
  const value = ExecutionPolicyView.parse(policy);
  return ExecutionResourceSnapshot.parse({ version: "v1", policyRevision: value.revision, limits: { maxModelCalls: value.limits.maxModelCalls, maxChildRuns: value.limits.maxChildRuns }, coverage, frozenAt: now.toISOString() });
}
export function presentExecutionCapacity(policy: ExecutionPolicyView, counts: ExecutionCapacityCounts, now = new Date()): ExecutionPolicySnapshot {
  return ExecutionPolicySnapshot.parse({ policy, capacity: { ...counts, availableSlots: Math.max(0, policy.limits.maxConcurrentChains - counts.reservedChains) }, assessedAt: now.toISOString() });
}
export function executionResourceAdmission(kind: ExecutionResourceLimit["kind"], current: number, maximum: number): ExecutionResourceAdmission {
  ExecutionResourceCount.parse(current); ExecutionResourceCount.parse(maximum);
  ExecutionResourceLimit.shape.kind.parse(kind);
  const field = { "concurrent-chains": "maxConcurrentChains", "model-calls": "maxModelCalls", "child-runs": "maxChildRuns" } as const;
  ExecutionResourceLimits.shape[field[kind]].parse(maximum);
  return ExecutionResourceAdmission.parse(current < maximum ? { allowed: true } : { allowed: false, limit: { kind, current, maximum } });
}
export function executionResourceLimitMessage(limit: ExecutionResourceLimit): string {
  const labels = { "concurrent-chains": "当前执行链已达到并发上限，请等待已有任务结束后使用原请求重试", "model-calls": "本次执行链已达到模型调用上限，不能继续发起新调用", "child-runs": "本次执行链已达到协作任务上限，不能继续创建新任务" };
  return labels[limit.kind];
}
