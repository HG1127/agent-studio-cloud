import { describe, expect, it } from "vitest";
import { KnowledgeQuery, KnowledgeReceipt } from "@/contracts/knowledge";

const receipt = { ok: true, space: "售后资料", query: "退货政策", scannedCount: 1, truncated: false, hitCount: 1, hits: [{ source: "售后手册", chunkIndex: 0, excerpt: "七天内退货", score: 1.5 }] };

describe("知识步骤回执共享契约", () => {
  it("明确检索词保持文字与零值语义，不进行布尔或对象数值转换", () => {
    expect(KnowledgeQuery.parse(" 退货政策 ")).toBe("退货政策");
    expect(KnowledgeQuery.parse("00123")).toBe("00123");
    expect(KnowledgeQuery.parse(0)).toBe("0");
  });
  it.each([null, false, [], {}, Infinity, "   ", "x".repeat(1_001)])("无效或超限明确检索词不能进入查询 %#", (value) => {
    expect(KnowledgeQuery.safeParse(value).success).toBe(false);
  });
  it("完整保留原回执字段，不对前端另写类型，也不携带内部来源标识", () => {
    expect(KnowledgeReceipt.parse(receipt)).toEqual(receipt);
    expect(KnowledgeReceipt.parse({ ...receipt, hits: [{ ...receipt.hits[0], sourceId: "internal-source" }] }).hits[0]).not.toHaveProperty("sourceId");
  });
  it.each([{ ...receipt, hitCount: 2 }, { ...receipt, scannedCount: 0 }, { ...receipt, hits: [{ ...receipt.hits[0], chunkIndex: -1 }] }, { ...receipt, hits: [{ ...receipt.hits[0], score: Infinity }] }])("无效数量或证据元数据不能冒充有效回执 %#", (value) => {
    expect(KnowledgeReceipt.safeParse(value).success).toBe(false);
  });
});
