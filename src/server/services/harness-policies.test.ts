import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessPolicyDataError, freezeWorkspaceHarnessPolicy, presentHarnessPolicy } from "@/server/domain/harness/management";
const mocks = vi.hoisted(() => ({ rows: vi.fn(), execute: vi.fn(), filters: [] as SQL[] }));
const client = {
  select: () => { const query = { from: () => query, where: (filter: SQL) => { mocks.filters.push(filter); return query; }, limit: mocks.rows }; return query; },
  execute: mocks.execute,
};
vi.mock("@/lib/db", () => ({ db: { select: () => { const query = { from: () => query, where: (filter: SQL) => { mocks.filters.push(filter); return query; }, limit: mocks.rows }; return query; } } }));
import { freezeRunHarnessPolicy, lockHarnessWorkspace, readRunHarnessPolicy, readWorkspaceHarnessPolicy } from "./harness-policies";
const tx = client as unknown as Parameters<typeof freezeRunHarnessPolicy>[0];
const workspaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", parentRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", now = new Date("2026-10-12T00:00:00.000Z");
const empty = presentHarnessPolicy(null), snapshot = freezeWorkspaceHarnessPolicy(workspaceId, empty, now);
const root = { workspaceId, parentRunId: null, sourceType: "manual", harnessPolicySnapshot: null };
beforeEach(() => { mocks.rows.mockReset().mockResolvedValue([]); mocks.execute.mockReset().mockResolvedValue([]); mocks.filters = []; });

describe("规则工作区读取与父快照继承", () => {
  it("规范工作区锁避免 UUID 大小写绕过", async () => {
    await lockHarnessWorkspace(tx, workspaceId.toUpperCase());
    expect(new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]).params).toContain(`harness-policy:${workspaceId}`);
    await expect(lockHarnessWorkspace(tx, "foreign")).rejects.toBeInstanceOf(HarnessPolicyDataError);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("根首次启动读取本工作区管理版本并冻结空配置", async () => {
    expect(await freezeRunHarnessPolicy(tx, root, now)).toEqual(snapshot);
    expect(mocks.execute).toHaveBeenCalledOnce(); expect(mocks.rows).toHaveBeenCalledOnce();
    expect(new PgDialect().sqlToQuery(mocks.filters[0]).params).toContain(workspaceId);
  });
  it.each(["agent_call", "handoff"])("%s 继承实际同工作区父记录，不读取当前管理规则", async (sourceType) => {
    mocks.rows.mockResolvedValueOnce([{ workspaceId, snapshot, status: "running" }]);
    expect(await freezeRunHarnessPolicy(tx, { ...root, sourceType, parentRunId }, now)).toEqual(snapshot);
    expect(mocks.rows).toHaveBeenCalledOnce(); expect(mocks.execute).not.toHaveBeenCalled();
    expect(new PgDialect().sqlToQuery(mocks.filters[0]).params).toEqual(expect.arrayContaining([workspaceId, parentRunId]));
  });
  it("历史父 null 快照的子运行保留 env-only", async () => {
    mocks.rows.mockResolvedValueOnce([{ workspaceId, snapshot: null, status: "running" }]);
    expect(await freezeRunHarnessPolicy(tx, { ...root, sourceType: "agent_call", parentRunId }, now)).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("缺父、跨工作区、未启动父或非法父快照全部拒绝", async () => {
    for (const rows of [[], [{ workspaceId: parentRunId, snapshot, status: "running" }], [{ workspaceId, snapshot: null, status: "queued" }], [{ workspaceId, snapshot: {}, status: "running" }]]) {
      mocks.rows.mockResolvedValueOnce(rows);
      await expect(freezeRunHarnessPolicy(tx, { ...root, sourceType: "agent_call", parentRunId }, now)).rejects.toBeInstanceOf(HarnessPolicyDataError);
    }
    await expect(freezeRunHarnessPolicy(tx, { ...root, sourceType: "handoff" }, now)).rejects.toBeInstanceOf(HarnessPolicyDataError);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("已有 queued 冻结字段或未知来源不能重冻结", async () => {
    await expect(freezeRunHarnessPolicy(tx, { ...root, harnessPolicySnapshot: snapshot }, now)).rejects.toBeInstanceOf(HarnessPolicyDataError);
    await expect(freezeRunHarnessPolicy(tx, { ...root, sourceType: "unknown" }, now)).rejects.toBeInstanceOf(HarnessPolicyDataError);
    expect(mocks.rows).not.toHaveBeenCalled();
  });
  it("执行读取只取运行冻结快照，不读当前配置", async () => {
    mocks.rows.mockResolvedValueOnce([{ workspaceId, snapshot }]);
    expect(await readRunHarnessPolicy(parentRunId)).toEqual({ workspaceId, snapshot });
    const query = new PgDialect().sqlToQuery(mocks.filters[0]); expect(query.params).toEqual([parentRunId]);
    expect(mocks.rows).toHaveBeenCalledOnce();
    mocks.rows.mockResolvedValueOnce([{ workspaceId, snapshot: undefined }]);
    await expect(readRunHarnessPolicy(parentRunId)).rejects.toBeInstanceOf(HarnessPolicyDataError);
  });
  it("非法查询身份与损坏配置不返回部分正文", async () => {
    await expect(readWorkspaceHarnessPolicy(tx, "foreign")).rejects.toBeInstanceOf(HarnessPolicyDataError);
    expect(mocks.rows).not.toHaveBeenCalled();
    mocks.rows.mockResolvedValueOnce([{ id: parentRunId, revision: 1, policy: { version: 2 }, updatedAt: now, archivedAt: null }]);
    await expect(readWorkspaceHarnessPolicy(tx, workspaceId)).rejects.toBeInstanceOf(HarnessPolicyDataError);
  });
});
