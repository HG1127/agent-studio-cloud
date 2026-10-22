import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const snapshot = (tag: string) => JSON.parse(source(`src/db/migrations/meta/${tag}_snapshot.json`));
const tableNames = [
  "default_result_deliveries", "harness_policies", "harness_policy_changes",
  "public_agent_tool_calls", "public_agent_tool_changes", "public_agent_tool_keys", "public_agent_tools",
];
const sql = source("src/db/migrations/0035_mvp_backend.sql");

describe("最小后端链路追加迁移", () => {
  it("仅追加七表和两列，保留全部已有表定义与快照元数据", () => {
    const previous = snapshot("0034");
    const current = snapshot("0035");
    expect(current.prevId).toBe(previous.id);
    expect(current.id).not.toBe(previous.id);
    expect(Object.keys(current.tables).filter((name) => !Object.hasOwn(previous.tables, name)).sort())
      .toEqual(tableNames.map((name) => `public.${name}`).sort());
    expect(Object.keys(current.tables)).toHaveLength(Object.keys(previous.tables).length + tableNames.length);
    for (const name of tableNames) delete current.tables[`public.${name}`];
    expect(current.tables["public.runs"].columns.default_result_tracking_version)
      .toEqual({ name: "default_result_tracking_version", type: "text", primaryKey: false, notNull: false });
    expect(current.tables["public.runs"].columns.harness_policy_snapshot)
      .toEqual({ name: "harness_policy_snapshot", type: "jsonb", primaryKey: false, notNull: false });
    delete current.tables["public.runs"].columns.default_result_tracking_version;
    delete current.tables["public.runs"].columns.harness_policy_snapshot;
    expect({ ...current, id: previous.id, prevId: previous.prevId }).toEqual(previous);
  });

  it("新增业务表必有归属和时间字段，未给历史运行强加默认值", () => {
    const current = snapshot("0035");
    for (const name of tableNames) {
      const table = current.tables[`public.${name}`];
      for (const column of ["workspace_id", "created_by"]) {
        expect(table.columns[column]).toEqual({ name: column, type: "uuid", primaryKey: false, notNull: true });
      }
      for (const column of ["created_at", "updated_at"]) {
        expect(table.columns[column]).toEqual({ name: column, type: "timestamp with time zone", primaryKey: false, notNull: true, default: "now()" });
      }
    }
    expect(sql.match(/ALTER TABLE "runs" ADD COLUMN [^;]+;/g)).toEqual([
      'ALTER TABLE "runs" ADD COLUMN "default_result_tracking_version" text;',
      'ALTER TABLE "runs" ADD COLUMN "harness_policy_snapshot" jsonb;',
    ]);
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\b|\bDELETE\s+FROM\b|ALTER\s+COLUMN|collaboration_tracking_version/i);
  });

  it("SQL包含快照的全部新索引和外键，且没有额外表或结构操作", () => {
    const current = snapshot("0035");
    expect([...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]).sort()).toEqual([...tableNames].sort());
    const indexes: string[] = [], foreignKeys: string[] = [];
    for (const name of tableNames) {
      const table = current.tables[`public.${name}`];
      indexes.push(...Object.keys(table.indexes));
      foreignKeys.push(...Object.keys(table.foreignKeys));
    }
    expect(indexes).toHaveLength(11);
    expect(foreignKeys).toHaveLength(5);
    expect([...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)].map((match) => match[1]).sort()).toEqual(indexes.sort());
    expect([...sql.matchAll(/ADD CONSTRAINT "([^"]+)" FOREIGN KEY/g)].map((match) => match[1]).sort()).toEqual(foreignKeys.sort());
    expect(sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean)).toHaveLength(25);
  });

  it("迁移登记按固定序号保留前项，只登记一次，并允许后续追加", () => {
    const journal = JSON.parse(source("src/db/migrations/meta/_journal.json"));
    expect(journal).toMatchObject({ version: "7", dialect: "postgresql" });
    expect(journal.entries[34]).toMatchObject({ idx: 34, version: "7", tag: "0034_evaluation-result-schema", breakpoints: true });
    expect(journal.entries[35]).toMatchObject({ idx: 35, version: "7", tag: "0035_mvp_backend", breakpoints: true });
    expect(journal.entries.filter((entry: { idx: number; tag: string }) => entry.idx === 35 || entry.tag === "0035_mvp_backend")).toHaveLength(1);
    expect(journal.entries[35].when).toBeGreaterThan(journal.entries[34].when);
  });
});
