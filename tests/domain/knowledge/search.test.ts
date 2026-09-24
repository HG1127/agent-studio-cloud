import { describe, expect, it } from "vitest";
import { scoreChunks } from "@/server/domain/knowledge/search";

const docs = [
  { sourceId: "s1", sourceName: "售后手册", chunkIndex: 0, content: "开头即说明退货政策：签收后 7 天内可退。" },
  { sourceId: "s2", sourceName: "售后手册", chunkIndex: 1, content: `${"无关的填充内容。".repeat(40)}末尾提到退货政策。` },
  { sourceId: "s3", sourceName: "商品说明", chunkIndex: 0, content: "本商品为演示样例，与售后无关。" },
];

describe("scoreChunks", () => {
  it("按命中位置与频次排序：开头命中排最前", () => {
    const hits = scoreChunks("退货政策", docs);
    expect(hits[0].sourceId).toBe("s1");
    expect(hits.map((h) => h.sourceId)).not.toContain("s3");
  });

  it("中文长查询整体按子串匹配命中", () => {
    const hits = scoreChunks("退货政策", docs);
    expect(hits.length).toBe(2);
  });

  it("中文任务句能命中已上传资料中的主题短语", () => {
    const hits = scoreChunks("检索海蓝灯塔二四资料", [
      { sourceId: "pilot", sourceName: "客户咨询处理验收资料", chunkIndex: 0, content: "客户退货回复须负责人确认。验收标记：海蓝灯塔二四。" },
      { sourceId: "other", sourceName: "其他资料", chunkIndex: 0, content: "这是一份没有对应验收标记的资料。" },
    ]);
    expect(hits.map((hit) => hit.sourceId)).toEqual(["pilot"]);
  });

  it("完整查询命中排在通用片段命中之前，不被结果上限挤掉", () => {
    const query = "读取资料生成回复方案f1a2b3c4-1234-5678-9abc-123456789abc";
    const common = Array.from({ length: 12 }, (_, index) => ({
      sourceId: `common-${index}`,
      sourceName: "通用资料",
      chunkIndex: index,
      content: "读取资料生成回复方案。".repeat(20),
    }));
    const exact = { sourceId: "exact", sourceName: "本次上传的资料", chunkIndex: 0, content: `${query}\n客户咨询处理规则。` };
    const hits = scoreChunks(query, [...common, exact], { limit: 8 });
    expect(hits).toHaveLength(8);
    expect(hits[0].sourceId).toBe("exact");
  });

  it("多词英文查询按空白拆分逐词命中", () => {
    const hits = scoreChunks("refund policy", [{ sourceId: "s4", sourceName: "en", chunkIndex: 0, content: "Our refund policy is simple." }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("无命中与空查询返回空数组，excerpt 截断到 700 字符", () => {
    expect(scoreChunks("完全不相关的词", docs)).toHaveLength(0);
    expect(scoreChunks("", docs)).toHaveLength(0);
    const long = scoreChunks("填充内容", [{ sourceId: "s5", sourceName: "n", chunkIndex: 0, content: "填充内容。".repeat(200) }]);
    expect(long[0].excerpt.length).toBeLessThanOrEqual(700);
  });

  it("limit 生效", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ sourceId: `s${i}`, sourceName: "n", chunkIndex: i, content: "退货政策说明" }));
    expect(scoreChunks("退货政策", many, { limit: 8 })).toHaveLength(8);
  });
});
