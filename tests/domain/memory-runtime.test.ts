import { describe, expect, it } from "vitest";
import { buildMemoryContent } from "@/server/domain/memory/memory-content";
import { selectRelevantMemories } from "@/server/domain/memory/memory-search";

describe("长期经验运行逻辑", () => {
  it("保存前隐藏敏感字段并保留业务结果", () => {
    const content = buildMemoryContent({
      input: { customer: "甲公司", apiKey: "sk-private", nested: { password: "secret", topic: "续约" } },
      outputs: { summary: "建议提前三十天沟通" },
    });
    expect(content).toContain("甲公司");
    expect(content).toContain("提前三十天");
    expect(content).not.toContain("sk-private");
    expect(content).not.toContain('"secret"');
    expect(content).toContain("[已隐藏敏感信息]");
  });

  it("优先返回内容相关的经验，并在没有查询词时返回最新记录", () => {
    const older = { content: "客户续约需要提前沟通", createdAt: new Date("2026-01-01") };
    const newer = { content: "采购审批需要负责人确认", createdAt: new Date("2026-02-01") };
    expect(selectRelevantMemories("客户续约", [older, newer], 5)).toEqual([older]);
    expect(selectRelevantMemories("", [older, newer], 1)).toEqual([newer]);
  });
});
