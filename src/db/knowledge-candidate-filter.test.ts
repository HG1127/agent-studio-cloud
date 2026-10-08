import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { knowledgeCandidateFilter, knowledgeExactMatchFilter } from "@/db/knowledge-candidate-filter";

const dialect = new PgDialect();

describe("知识候选分片数据库过滤", () => {
  it("使用参数化模糊匹配包含完整词和中文三字片段", () => {
    const query = dialect.sqlToQuery(knowledgeCandidateFilter("检索海蓝灯塔二四资料"));
    expect(query.sql).toContain('"knowledge_chunks"."content" ILIKE ANY (ARRAY[');
    expect(query.params).toContain("%检索海蓝灯塔二四资料%");
    expect(query.params).toContain("%海蓝灯%");
    const exact = dialect.sqlToQuery(knowledgeExactMatchFilter("检索海蓝灯塔二四资料"));
    expect(exact.params).toEqual(["%检索海蓝灯塔二四资料%"]);
  });

  it("转义模糊匹配通配符并拒绝空查询", () => {
    const query = dialect.sqlToQuery(knowledgeCandidateFilter("refund%_\\"));
    expect(query.params).toContain("%refund\\%\\_\\\\%");
    expect(dialect.sqlToQuery(knowledgeCandidateFilter("  ")).sql).toBe("false");
  });
});
