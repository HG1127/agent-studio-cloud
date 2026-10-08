import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ExecutionPolicyHistoryInput, ExecutionPolicyHistoryResult, ExecutionPolicyInput, ExecutionPolicyReadResult, ExecutionPolicyWriteResult, ExecutionResourceLimit, ExecutionResourceRawCount, ExecutionResourceSnapshot } from "@/contracts/execution-resources";
import { StartRunResult } from "@/contracts/run";
import { executionPolicies, executionPolicyChanges, runs } from "@/db/schema";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", time = "2026-10-09T12:00:00.000Z";
const limits = { maxConcurrentChains: 2, maxModelCalls: 3, maxChildRuns: 0 };
const input = { requestId: id, expectedRevision: 0, confirmed: true, limits, reason: "试点资源上限" };
const policy = { revision: 1, source: "configured", limits, updatedAt: time };
const item = { id, requestId: id, revision: 1, previousLimits: limits, limits, reason: "试点", createdAt: time };
describe("执行资源共享契约", () => {
  it("请求严格拒绝伪造归属、未确认、超限及未知字段，统一请求标识", () => {
    expect(ExecutionPolicyInput.parse({ ...input, requestId: id.toUpperCase() }).requestId).toBe(id);
    for (const bad of [{ ...input, workspaceId: id }, { ...input, confirmed: false }, { ...input, expectedRevision: 2_147_483_647 }, { ...input, reason: " " }, { ...input, limits: { ...limits, maxChildRuns: 200 } }, { ...input, limits: { ...limits, price: 0 } }]) expect(ExecutionPolicyInput.safeParse(bad).success).toBe(false);
  });
  it("计数只接受安全非负整数，不把溢出或缺失转成零", () => {
    expect(ExecutionResourceRawCount.parse("0")).toBe(0);
    for (const raw of [undefined, null, "-1", "1.5", "1e2", "9007199254740992", ""]) expect(ExecutionResourceRawCount.safeParse(raw).success).toBe(false);
  });
  it("旧请求找回明确原记录版本和当前设置，不伪称原限制仍生效", () => {
    expect(ExecutionPolicyWriteResult.parse({ ok: true, recordedRevision: 1, policy: { ...policy, revision: 3 } })).toMatchObject({ recordedRevision: 1, policy: { revision: 3 } });
    expect(ExecutionPolicyWriteResult.safeParse({ ok: true, recordedRevision: 2, policy }).success).toBe(false);
    expect(ExecutionPolicyWriteResult.safeParse({ ok: false, error: "失败", retryable: true, conflict: true }).success).toBe(false);
  });
  it("来源、可用名额与检查快照一致，不能虚报可用", () => {
    const value = { ok: true, snapshot: { policy, capacity: { reservedChains: 2, untrackedActiveRuns: 1, availableSlots: 0 }, assessedAt: time } };
    expect(ExecutionPolicyReadResult.safeParse(value).success).toBe(true);
    expect(ExecutionPolicyReadResult.safeParse({ ...value, snapshot: { ...value.snapshot, capacity: { ...value.snapshot.capacity, availableSlots: 1 } } }).success).toBe(false);
    expect(ExecutionPolicyReadResult.safeParse({ ...value, snapshot: { ...value.snapshot, policy: { ...policy, source: "default" } } }).success).toBe(false);
  });
  it("冻结覆盖与上限明确，不接受工作区并发或虚构费用字段", () => {
    const value = { version: "v1", policyRevision: 0, limits: { maxModelCalls: 1, maxChildRuns: 0 }, coverage: "legacy-or-partial", frozenAt: time };
    expect(ExecutionResourceSnapshot.safeParse(value).success).toBe(true);
    expect(ExecutionResourceSnapshot.safeParse({ ...value, limits }).success).toBe(false);
    expect(ExecutionResourceSnapshot.safeParse({ ...value, amount: 0 }).success).toBe(false);
  });
  it("历史游标严格降序，重复版本与不匹配游标拒绝", () => {
    expect(ExecutionPolicyHistoryInput.parse({})).toEqual({ limit: 20 });
    expect(ExecutionPolicyHistoryInput.safeParse({ workspaceId: id }).success).toBe(false);
    expect(ExecutionPolicyHistoryResult.safeParse({ ok: true, items: [item], nextBeforeRevision: 1 }).success).toBe(true);
    expect(ExecutionPolicyHistoryResult.safeParse({ ok: true, items: [item, item], nextBeforeRevision: 1 }).success).toBe(false);
    expect(ExecutionPolicyHistoryResult.safeParse({ ok: true, items: [item], nextBeforeRevision: 2 }).success).toBe(false);
  });
  it("容量拒绝复用运行契约且拒绝虚构未达到上限", () => {
    expect(StartRunResult.safeParse({ ok: false, error: "并发已满", retryable: true, resourceLimit: { kind: "concurrent-chains", current: 2, maximum: 2 } }).success).toBe(true);
    expect(ExecutionResourceLimit.safeParse({ kind: "model-calls", current: 0, maximum: 1 }).success).toBe(false);
    expect(ExecutionResourceLimit.safeParse({ kind: "model-calls", current: 0, maximum: 0 }).success).toBe(false);
  });
  it("所有设置和历史都有业务归属、必填 JSON，运行列保持可空且无默认", () => {
    for (const table of [executionPolicies, executionPolicyChanges]) {
      const columns = getTableColumns(table);
      for (const field of ["workspaceId", "createdBy", "createdAt", "updatedAt"] as const) expect(columns[field].notNull).toBe(true);
      expect(columns.archivedAt.notNull).toBe(false);
    }
    expect(getTableColumns(executionPolicies).limits.notNull).toBe(true);
    expect(getTableConfig(executionPolicies).indexes[0].config.unique).toBe(true);
    expect(getTableConfig(executionPolicyChanges).indexes).toHaveLength(2);
    for (const field of ["executionRootRunId", "executionResources"] as const) { expect(runs[field].notNull).toBe(false); expect(runs[field].default).toBeUndefined(); }
    expect(getTableConfig(runs).indexes.some((index) => index.config.name === "runs_workspace_execution_reservation_idx" && index.config.where)).toBe(true);
  });
});
