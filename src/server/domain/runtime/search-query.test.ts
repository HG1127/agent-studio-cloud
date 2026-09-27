import { describe, expect, it } from "vitest";
import { searchQueryFromInput, searchQueryFromContext } from "@/server/domain/runtime/search-query";

describe("从运行输入生成检索内容", () => {
  it("优先使用业务问题字段", () => {
    expect(searchQueryFromInput({ customer: "甲公司", question: "退货期限是多少" })).toBe("退货期限是多少");
    expect(searchQueryFromInput({ input: "整理续约建议", brief: "不会被采用" })).toBe("整理续约建议");
  });

  it("汇总结构化输入中的嵌套值且去重", () => {
    expect(searchQueryFromInput({
      customer: { name: "甲公司", tags: ["续约", "重点客户"] },
      duplicate: "续约",
      year: 2027,
      ignored: false,
    })).toBe("甲公司 续约 重点客户 2027");
  });

  it("限制单个字段长度，让靠后的检索主题仍能参与召回", () => {
    const query = searchQueryFromInput({ context: "无关".repeat(500), topic: "客户续约政策" });

    expect(query.length).toBeLessThanOrEqual(1_000);
    expect(query).toContain("客户续约政策");
  });

  it("逐项处理优先使用当前项的问题，当前项无内容时回退全局输入", () => {
    expect(searchQueryFromContext({ question: "全局问题" }, { question: "甲公司退款期限" })).toBe("甲公司退款期限");
    expect(searchQueryFromContext({ question: "全局问题" }, "乙公司续约期限")).toBe("乙公司续约期限");
    expect(searchQueryFromContext({ question: "全局问题" }, {})).toBe("全局问题");
  });
});
