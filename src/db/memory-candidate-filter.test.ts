import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { memoryCandidateFilter, memoryExactMatchFilter } from "@/db/memory-candidate-filter";

const dialect = new PgDialect();

describe("长期经验候选数据库过滤", () => {
  it("参数化匹配完整词和中文片段，并把完整词单独用于排序", () => {
    const candidates = dialect.sqlToQuery(memoryCandidateFilter("请参考客户续约的历史经验")!);
    const exact = dialect.sqlToQuery(memoryExactMatchFilter("请参考客户续约的历史经验")!);
    expect(candidates.sql).toContain('"agent_memories"."content" ILIKE ANY (ARRAY[');
    expect(candidates.params).toContain("%客户续%");
    expect(exact.params).toEqual(["%请参考客户续约的历史经验%"]);
  });

  it("模糊匹配通配符被转义，空查询不加过滤", () => {
    const filtered = dialect.sqlToQuery(memoryCandidateFilter("key%_\\")!);
    expect(filtered.params).toContain("%key\\%\\_\\\\%");
    expect(memoryCandidateFilter("，。 ")).toBeUndefined();
    expect(memoryExactMatchFilter("，。 ")).toBeUndefined();
  });
});
