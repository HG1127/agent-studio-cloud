import { describe, expect, it } from "vitest";
import { observeUnmigratedUserRelationCount, parseAcceptanceConnectionCounts } from "./workflow-acceptance-observation";

describe("隔离执行域连接观测解析", () => {
  it("保留真实零与非零连接", () => {
    expect(parseAcceptanceConnectionCounts([{ database_connections: "0", active_sql: "0" }])).toEqual({ databaseConnections: 0, activeSql: 0 });
    expect(parseAcceptanceConnectionCounts([{ database_connections: "2", active_sql: "1" }])).toEqual({ databaseConnections: 2, activeSql: 1 });
  });
  it.each([null, [], [{ database_connections: null, active_sql: "0" }],
    [{ database_connections: "0", active_sql: "1" }], [{ database_connections: "9007199254740992", active_sql: "0" }],
    [{ database_connections: "01", active_sql: "0" }]])("未知或失真观测不会转成零", (raw) => {
    expect(parseAcceptanceConnectionCounts(raw)).toBeNull();
  });
  it("不执行字段访问器", () => {
    let read = false;
    const row = { get database_connections() { read = true; return "0"; }, active_sql: "0" };
    expect(parseAcceptanceConnectionCounts([row])).toBeNull();
    expect(read).toBe(false);
  });
});

describe("迁移前用户关系对象计数", () => {
  it("只真实零计数为零", async () => {
    expect(await observeUnmigratedUserRelationCount(async () => [{ user_relations: "0" }])).toBe(0);
    expect(await observeUnmigratedUserRelationCount(async () => [{ user_relations: "3" }])).toBe(3);
  });
  it("查询失败或非法值保持未知", async () => {
    expect(await observeUnmigratedUserRelationCount(async () => { throw new Error("fixture"); })).toBeNull();
    expect(await observeUnmigratedUserRelationCount(async () => [{ user_relations: null }])).toBeNull();
  });
  it("不读取计数字段访问器", async () => {
    let read = false;
    expect(await observeUnmigratedUserRelationCount(async () => [{ get user_relations() { read = true; return "0"; } }])).toBeNull();
    expect(read).toBe(false);
  });
});
