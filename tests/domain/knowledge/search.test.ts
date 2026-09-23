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
