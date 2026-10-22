import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rows: vi.fn(), saved: vi.fn(), values: vi.fn(), where: vi.fn(), lock: vi.fn(), transaction: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction, update: mocks.update } }));
vi.mock("@/server/services/execution-resources", () => ({ lockExecutionWorkspace: mocks.lock }));
import { admitPublicToolCall, bindPublicToolRun, managePublicTool } from "./public-agent-tools";
import { publicToolCanonicalJson, publicToolHash, publicToolInputHash } from "@/server/domain/public-agent-tool";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { publicToolTestCall, publicToolTestPublication, publicToolTestView, PUBLIC_TOOL_TEST_IDS as ids } from "../../../tests/fixtures/public-agent-tool";

type Query = {
  from: () => Query; innerJoin: () => Query; where: (value: unknown) => Query; for: () => Query; limit: () => Promise<unknown>;
  values: (value: unknown) => Query; set: (value: unknown) => Query; returning: () => Promise<unknown>;
  then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise<unknown>;
};
function query(kind: "select" | "mutation"): Query {
  const q: Query = { from: () => q, innerJoin: () => q, where: (value) => { mocks.where(value); return q; }, for: () => q,
    limit: () => mocks.rows(), values: (value) => { mocks.values(value); return q; }, set: (value) => { mocks.values(value); return q; },
    returning: () => mocks.saved(), then: (resolve, reject) => (kind === "select" ? mocks.rows() : Promise.resolve([])).then(resolve, reject) };
  return q;
}
const tx = { select: () => query("select"), insert: () => query("mutation"), update: () => query("mutation") };
function toolRow() { const view = publicToolTestView(); return { id: ids.tool, ...view, publication: publicToolTestPublication(), createdAt: new Date(view.createdAt), updatedAt: new Date(view.updatedAt), archivedAt: null }; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows.mockReset().mockResolvedValue([]); mocks.saved.mockReset().mockResolvedValue([]);
  mocks.transaction.mockImplementation((callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  mocks.update.mockImplementation(() => query("mutation")); mocks.lock.mockResolvedValue(undefined);
});
describe("公开工具事务服务 mock", () => {
  it("创建原子保存定义与管理请求，工作区必填", async () => {
    mocks.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ value: 0 }]); mocks.saved.mockResolvedValueOnce([{ ...toolRow(), revision: 1, status: "draft", publication: null }]);
    const result = await managePublicTool({ operation: "create", requestId: ids.request, name: "公开工具", description: "", confirmed: true });
    expect(result).toMatchObject({ ok: true, recordedRevision: 1 });
    expect(mocks.lock).toHaveBeenCalledWith(tx, DEMO_WORKSPACE_ID);
    expect(mocks.values.mock.calls.every(([value]) => typeof value === "object" && value.workspaceId === DEMO_WORKSPACE_ID)).toBe(true);
  });
  it("管理请求回放只返无秘密元数据，不刷新旧明文或变更版本", async () => {
    const input = { operation: "mint-key" as const, toolId: ids.tool, expectedRevision: 2, requestId: ids.request, name: "调用方", expiresAt: null, confirmed: true as const };
    const requestHash = publicToolHash(publicToolCanonicalJson(input));
    mocks.rows.mockResolvedValueOnce([{ requestHash, toolId: ids.tool, revision: 3, keyId: ids.key }])
      .mockResolvedValueOnce([toolRow()]).mockResolvedValueOnce([{ id: ids.key, name: "调用方", expiresAt: null, revokedAt: null, createdAt: new Date() }]);
    const result = await managePublicTool(input);
    expect(result).toMatchObject({ ok: true, recordedRevision: 3 }); expect(result).not.toHaveProperty("token");
    expect(mocks.values).not.toHaveBeenCalled();
  });
  it("新密钥仅写哈希，返回明文不进入变更记录", async () => {
    mocks.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([toolRow()]).mockResolvedValueOnce([{ value: 0 }]);
    mocks.saved.mockResolvedValueOnce([{ id: ids.key, name: "调用方", expiresAt: null, revokedAt: null, createdAt: new Date() }])
      .mockResolvedValueOnce([{ ...toolRow(), revision: 3 }]);
    const result = await managePublicTool({ operation: "mint-key", toolId: ids.tool, expectedRevision: 2, requestId: ids.request, name: "调用方", expiresAt: null, confirmed: true });
    if (!result.ok || !result.token) throw new Error("缺少一次密钥");
    const token = result.token;
    const values = mocks.values.mock.calls.map(([value]) => value);
    expect(values.some((value) => value.tokenHash === publicToolHash(token))).toBe(true);
    expect(JSON.stringify(values)).not.toContain(token);
    expect(JSON.stringify(result.key)).not.toContain("tokenHash");
    const activeKeysQuery = new PgDialect().sqlToQuery(mocks.where.mock.calls[2][0]);
    expect(activeKeysQuery.sql).toContain('"expires_at" >');
    expect(activeKeysQuery.params).toEqual([
      DEMO_WORKSPACE_ID, ids.tool, expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    ]);
  });
  it("同一管理请求键序重排仍回放原记录，Unicode 文字保留且不依赖地区比较", async () => {
    const input = { operation: "create" as const, requestId: ids.request, confirmed: true as const, name: "\u00e9", description: "e\u0301" };
    const reversed: typeof input = { description: input.description, name: input.name, confirmed: input.confirmed, requestId: input.requestId, operation: input.operation };
    const requestHash = publicToolHash(publicToolCanonicalJson(input));
    const saved = { ...toolRow(), name: input.name, description: input.description, revision: 1, status: "draft", publication: null };
    mocks.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ value: 0 }])
      .mockResolvedValueOnce([{ requestHash, toolId: ids.tool, revision: 1, keyId: null }]).mockResolvedValueOnce([saved]);
    mocks.saved.mockResolvedValueOnce([saved]);
    const locale = vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => { throw new Error("不允许地区比较"); });
    try {
      const first = await managePublicTool(input), replay = await managePublicTool(reversed);
      expect(first).toEqual(replay);
      expect(replay).toMatchObject({ ok: true, recordedRevision: 1, tool: { name: "\u00e9", description: "e\u0301" } });
      expect(mocks.saved).toHaveBeenCalledOnce();
      expect(mocks.values.mock.calls.map(([value]) => value)).toContainEqual(expect.objectContaining({ operation: "create", requestHash }));
      expect(locale).not.toHaveBeenCalled();
    } finally { locale.mockRestore(); }
  });
  it("已撤销/缺失/停用凭据在事务接收前拒绝，无外部启动", async () => {
    await expect(admitPublicToolCall("pat_" + "a".repeat(64), ids.tool, { requestId: ids.request, input: { amount: 0, approved: false } })).rejects.toMatchObject({ code: "unauthorized" });
    expect(mocks.values).not.toHaveBeenCalled();
  });
  it("同请求重试保留原发布绑定，输入改变冲突", async () => {
    const input = { requestId: ids.request, input: { amount: 0, approved: false } }, old = publicToolTestCall();
    const row = { id: old.callId, toolId: old.toolId, requestId: old.requestId, requestHash: publicToolInputHash(input.input),
      publication: old.publication, origin: old.origin, runId: ids.run, createdAt: new Date(old.receivedAt) };
    mocks.rows.mockResolvedValueOnce([{ keyId: ids.key, status: "enabled", expiresAt: null, publication: { ...publicToolTestPublication(), version: 2 } }]).mockResolvedValueOnce([row]);
    expect(await admitPublicToolCall("pat_" + "a".repeat(64), ids.tool, input)).toMatchObject({ publication: old.publication, runId: ids.run });
    expect(mocks.values).not.toHaveBeenCalled();
    const sqlQuery = new PgDialect().sqlToQuery(mocks.where.mock.calls[1][0]);
    expect(sqlQuery.params).toEqual(expect.arrayContaining([DEMO_WORKSPACE_ID, ids.tool, ids.request]));
  });
  it("保存关联响应未知时只报未确认，不能改写已关联运行", async () => {
    mocks.saved.mockResolvedValue([]);
    await expect(bindPublicToolRun(publicToolTestCall(), ids.run)).rejects.toMatchObject({ code: "unavailable" });
    const sqlQuery = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(sqlQuery.sql).toContain("run_id");
    expect(sqlQuery.params).toEqual(expect.arrayContaining([DEMO_WORKSPACE_ID, ids.call, ids.tool, ids.run]));
  });
});
