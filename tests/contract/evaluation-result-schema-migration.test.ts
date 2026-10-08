import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("验收结果字段规则追加迁移", () => {
  it("仅给原样例表追加可空无默认列，不改变其他表、索引或外键", () => {
    const previous = JSON.parse(readFileSync(new URL("../../src/db/migrations/meta/0033_snapshot.json", import.meta.url), "utf8"));
    const current = JSON.parse(readFileSync(new URL("../../src/db/migrations/meta/0034_snapshot.json", import.meta.url), "utf8"));
    expect(current.prevId).toBe(previous.id);
    expect(Object.keys(current.tables)).toHaveLength(26);
    const columns = current.tables["public.evaluation_cases"].columns;
    expect(columns.result_schema).toEqual({ name: "result_schema", type: "jsonb", primaryKey: false, notNull: false });
    delete columns.result_schema;
    expect(current.tables).toEqual(previous.tables);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views", "_meta"]) expect(current[key]).toEqual(previous[key]);
    expect(readFileSync(new URL("../../src/db/migrations/0034_evaluation-result-schema.sql", import.meta.url), "utf8").trim())
      .toBe('ALTER TABLE "evaluation_cases" ADD COLUMN "result_schema" jsonb;');
    const journal = JSON.parse(readFileSync(new URL("../../src/db/migrations/meta/_journal.json", import.meta.url), "utf8"));
    expect(journal.entries.at(-1)).toMatchObject({ idx: 34, tag: "0034_evaluation-result-schema" });
  });
});
