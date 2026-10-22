import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ select: vi.fn(), rows: vi.fn(), transaction: vi.fn(), where: vi.fn(),
  from: vi.fn(), order: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
import { getPublicToolKeys } from "./public-tool-keys";
import { publicAgentToolKeys, publicAgentTools } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { publicToolTestPublication, publicToolTestView, PUBLIC_TOOL_TEST_IDS as ids } from "../../../tests/fixtures/public-agent-tool";

const now = new Date("2026-10-12T00:00:00.000Z");
function toolRow() {
  const view = publicToolTestView();
  return { id: view.toolId, name: view.name, description: view.description, status: view.status, revision: view.revision,
    publication: publicToolTestPublication(), createdAt: now, updatedAt: now };
}
function keyRow(index = 1) {
  return { keyId: "10000000-0000-4000-8000-" + index.toString(16).padStart(12, "0"), name: "业务调用方",
    expiresAt: null as Date | null, revokedAt: null as Date | null, createdAt: now };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows.mockReset().mockResolvedValue([]);
  mocks.select.mockImplementation(() => {
    const query = { from: (table: unknown) => { mocks.from(table); return query; },
      where: (where: unknown) => { mocks.where(where); return query; },
      orderBy: (...order: unknown[]) => { mocks.order(...order); return query; },
      limit: (limit: number) => { mocks.limit(limit); return mocks.rows(); } };
    return query;
  });
  mocks.transaction.mockImplementation(async (callback: (tx: { select: typeof mocks.select }) => Promise<unknown>) => callback({ select: mocks.select }));
});
describe("管理员工具安全凭据查询", () => {
  it("非法标识或工作区输入在任何数据库读取前拒绝", async () => {
    await expect(getPublicToolKeys({ toolId: "invalid" })).rejects.toThrow();
    await expect(getPublicToolKeys({ toolId: ids.tool, workspaceId: ids.agent } as { toolId: string })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("不存在、外工作区或归档工具为null且不读取凭据", async () => {
    expect(await getPublicToolKeys({ toolId: ids.tool })).toBeNull();
    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith(publicAgentTools);
    expect(mocks.limit).toHaveBeenCalledOnce();
    expect(mocks.limit).toHaveBeenCalledWith(1);
    const where = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(where.params).toEqual([ids.tool, DEMO_WORKSPACE_ID]);
    expect(where.sql).toContain('"archived_at" is null');
  });
  it("无凭据时返回草稿管理详情和空清单，不伪报缺少工具", async () => {
    mocks.rows.mockResolvedValueOnce([{ ...toolRow(), status: "draft", publication: null }]).mockResolvedValueOnce([]);
    expect(await getPublicToolKeys({ toolId: ids.tool.toUpperCase() })).toMatchObject({
      tool: { toolId: ids.tool, status: "draft", publication: null }, keys: [], truncated: false,
    });
  });
  it("只读同快照安全列，凭据严格限定工具、工作区与未归档", async () => {
    mocks.rows.mockResolvedValueOnce([toolRow()]).mockResolvedValueOnce([keyRow()]);
    const result = await getPublicToolKeys({ toolId: ids.tool });
    expect(result).toMatchObject({ keys: [{ keyId: keyRow().keyId }], truncated: false });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
    expect(Object.keys(mocks.select.mock.calls[0][0])).toEqual(["id", "name", "description", "status", "revision", "publication", "createdAt", "updatedAt"]);
    expect(Object.keys(mocks.select.mock.calls[1][0])).toEqual(["keyId", "name", "expiresAt", "revokedAt", "createdAt"]);
    expect(mocks.select.mock.calls[1][0]).not.toHaveProperty("tokenHash");
    expect(mocks.select.mock.calls[1][0]).not.toHaveProperty("token");
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([publicAgentTools, publicAgentToolKeys]);
    const where = new PgDialect().sqlToQuery(mocks.where.mock.calls[1][0]);
    expect(where.params).toEqual([ids.tool, DEMO_WORKSPACE_ID]);
    expect(where.sql).toContain('"archived_at" is null');
    expect(where.sql).not.toContain("revoked_at");
    expect(where.sql).not.toContain("expires_at");
    expect(mocks.limit.mock.calls.map(([limit]) => limit)).toEqual([1, 101]);
    const order = mocks.order.mock.calls[0].map((value) => new PgDialect().sqlToQuery(value).sql);
    expect(order).toHaveLength(3);
    expect(order[0]).toMatch(/CASE WHEN[\s\S]*"revoked_at" IS NULL/);
    expect(order[0]).toContain('"expires_at" > CURRENT_TIMESTAMP');
    expect(order[0]).toMatch(/THEN 1 ELSE 0 END desc$/);
    expect(order[1]).toContain('"created_at" desc');
    expect(order[2]).toContain('"id" desc');
  });
  it("按有效优先SQL保留仍有效旧凭据，较新撤销历史只截断到一百条", async () => {
    const active = { ...keyRow(), createdAt: new Date("2026-10-01T00:00:00.000Z") };
    const history = Array.from({ length: 100 }, (_, index) => ({ ...keyRow(index + 2), revokedAt: now }));
    mocks.rows.mockResolvedValueOnce([toolRow()]).mockResolvedValueOnce([active, ...history]);
    const result = await getPublicToolKeys({ toolId: ids.tool });
    expect(result?.truncated).toBe(true);
    expect(result?.keys).toHaveLength(100);
    expect(result?.keys[0]).toMatchObject({ keyId: active.keyId, revokedAt: null, createdAt: active.createdAt.toISOString() });
    expect(result?.keys[99].keyId).toBe(history[98].keyId);
    expect(result?.keys.some((key) => key.keyId === history[99].keyId)).toBe(false);
    const priority = new PgDialect().sqlToQuery(mocks.order.mock.calls[0][0]);
    expect(priority.sql).toMatch(/CASE WHEN[\s\S]*"revoked_at" IS NULL/);
    expect(priority.sql).toMatch(/"expires_at" IS NULL OR[\s\S]*"expires_at" > CURRENT_TIMESTAMP/);
    expect(priority.sql).toMatch(/THEN 1 ELSE 0 END desc$/);
    expect(priority.params).toEqual([]);
  });
  it("已撤销和已到期凭据仍返回安全日期元数据", async () => {
    const expiredAt = new Date("2026-10-10T00:00:00.000Z"), revokedAt = new Date("2026-10-11T00:00:00.000Z");
    mocks.rows.mockResolvedValueOnce([{ ...toolRow(), status: "disabled" }]).mockResolvedValueOnce([
      { ...keyRow(), expiresAt: expiredAt }, { ...keyRow(2), revokedAt },
    ]);
    expect(await getPublicToolKeys({ toolId: ids.tool })).toMatchObject({ tool: { status: "disabled" },
      keys: [{ expiresAt: expiredAt.toISOString(), revokedAt: null }, { expiresAt: null, revokedAt: revokedAt.toISOString() }], truncated: false });
  });
  it("读取失败和持久名字中的凭据不能成为空清单或泄露正文", async () => {
    mocks.rows.mockRejectedValueOnce(new Error("模拟只读失败"));
    await expect(getPublicToolKeys({ toolId: ids.tool })).rejects.toThrow();
    mocks.rows.mockResolvedValueOnce([toolRow()]).mockResolvedValueOnce([{ ...keyRow(), name: "pat_" + "a".repeat(64) }]);
    await expect(getPublicToolKeys({ toolId: ids.tool })).rejects.toThrow("工具凭据元数据无效");
  });
});
