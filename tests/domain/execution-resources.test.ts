import { describe, expect, it } from "vitest";
import { DEFAULT_EXECUTION_RESOURCE_LIMITS, ExecutionCapacityCounts } from "@/contracts/execution-resources";
import { executionResourceAdmission, executionResourceLimitMessage, freezeExecutionResources, presentExecutionCapacity, presentExecutionPolicy } from "@/server/domain/execution-resources";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", now = new Date("2026-10-09T12:00:00Z");
const raw = { id, revision: 3, limits: { maxConcurrentChains: 2, maxModelCalls: 3, maxChildRuns: 1 }, updatedAt: now, archivedAt: null };
describe("执行资源纯规则", () => {
  it("只有确实缺少配置才使用默认值，损坏或停用配置不绕过限制", () => {
    expect(presentExecutionPolicy(null)).toEqual({ revision: 0, source: "default", limits: DEFAULT_EXECUTION_RESOURCE_LIMITS, updatedAt: null });
    expect(presentExecutionPolicy(raw)).toMatchObject({ revision: 3, source: "configured", updatedAt: now.toISOString() });
    for (const invalid of [undefined, {}, { ...raw, archivedAt: now }, { ...raw, revision: 0 }, { ...raw, limits: { ...raw.limits, maxModelCalls: 0 } }, { ...raw, secret: "private" }]) expect(() => presentExecutionPolicy(invalid)).toThrow();
  });
  it("冻结每条链的模型与协作限制，不冻结工作区并发名额，也不随后来设置变化", () => {
    const policy = presentExecutionPolicy(raw), snapshot = freezeExecutionResources(policy, "new-root", now);
    expect(snapshot).toEqual({ version: "v1", policyRevision: 3, coverage: "new-root", frozenAt: now.toISOString(), limits: { maxModelCalls: 3, maxChildRuns: 1 } });
    policy.limits.maxModelCalls = 100; expect(snapshot.limits.maxModelCalls).toBe(3);
    expect(freezeExecutionResources(presentExecutionPolicy(null), "legacy-or-partial", now).coverage).toBe("legacy-or-partial");
  });
  it.each(["concurrent-chains", "model-calls", "child-runs"] as const)("%s 到达上限立即拒绝，少一个可准入", (kind) => {
    expect(executionResourceAdmission(kind, 1, 2)).toEqual({ allowed: true });
    expect(executionResourceAdmission(kind, 2, 2)).toEqual({ allowed: false, limit: { kind, current: 2, maximum: 2 } });
    expect(executionResourceAdmission(kind, 3, 2).allowed).toBe(false);
    expect(executionResourceLimitMessage({ kind, current: 2, maximum: 2 })).not.toMatch(/workspace|runId|token/);
  });
  it("零协作额度表示禁止子任务，不因零值放开", () => { expect(executionResourceAdmission("child-runs", 0, 0)).toMatchObject({ allowed: false }); });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("非法计数 %s 不能伪报准入", (current) => { expect(() => executionResourceAdmission("model-calls", current, 3)).toThrow(); });
  it("准入时也验证限制类型与范围，而不仅在拒绝时验证", () => {
    expect(() => executionResourceAdmission("model-calls", 0, 0)).toThrow();
    expect(() => executionResourceAdmission("model-calls", 0, 10_001)).toThrow();
    expect(() => executionResourceAdmission("child-runs", 0, 200)).toThrow();
    expect(() => executionResourceAdmission("unknown" as "model-calls", 0, 3)).toThrow();
  });
  it("缩小工作区额度不伪报负名额，也不自动取消既有任务", () => {
    const policy = presentExecutionPolicy(raw), counts = ExecutionCapacityCounts.parse({ reservedChains: "5", untrackedActiveRuns: "2" });
    expect(presentExecutionCapacity(policy, counts, now)).toMatchObject({ capacity: { reservedChains: 5, untrackedActiveRuns: 2, availableSlots: 0 }, assessedAt: now.toISOString() });
    expect(presentExecutionCapacity(policy, { reservedChains: 1, untrackedActiveRuns: 0 }, now).capacity.availableSlots).toBe(1);
    expect(() => presentExecutionCapacity(policy, { reservedChains: 1, untrackedActiveRuns: 2 }, now)).toThrow();
  });
});
