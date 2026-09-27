import { describe, expect, it } from "vitest";
import { buildMemoryContent } from "@/server/domain/memory/memory-content";
import { memoryCandidateTerms, selectRelevantMemories } from "@/server/domain/memory/memory-search";

describe("长期经验运行逻辑", () => {
  it("保存前隐藏敏感字段并保留业务结果", () => {
    const content = buildMemoryContent({
      input: {
        customer: "甲公司",
        apiKey: "sk-private",
        privateKey: "private-key-content",
        accessKey: "access-key-content",
        credential: "credential-content",
        sessionId: "session-content",
        手机号: "13800000000",
        nested: { password: "secret", topic: "续约" },
      },
      outputs: { summary: "建议提前三十天沟通" },
    });
    expect(content).toContain("甲公司");
    expect(content).toContain("提前三十天");
    expect(content).not.toContain("sk-private");
    expect(content).not.toContain('"secret"');
    expect(content).not.toContain("private-key-content");
    expect(content).not.toContain("access-key-content");
    expect(content).not.toContain("credential-content");
    expect(content).not.toContain("session-content");
    expect(content).not.toContain("13800000000");
    expect(content).toContain("[已隐藏敏感信息]");
  });

  it("优先返回内容相关的经验，并在没有查询词时返回最新记录", () => {
    const older = { content: "客户续约需要提前沟通", createdAt: new Date("2026-01-01") };
    const newer = { content: "采购审批需要负责人确认", createdAt: new Date("2026-02-01") };
    expect(selectRelevantMemories("客户续约", [older, newer], 5)).toEqual([older]);
    expect(selectRelevantMemories("", [older, newer], 1)).toEqual([newer]);
  });

  it("中文任务句包含额外指令词时仍能找到中间的经验主题", () => {
    const renewal = { content: "客户续约需要提前三十天沟通", createdAt: new Date("2026-01-01") };
    const approval = { content: "采购审批需要负责人确认", createdAt: new Date("2026-02-01") };

    expect(selectRelevantMemories("请参考客户续约的历史经验", [approval, renewal], 5)).toEqual([renewal]);
  });

  it("候选词覆盖完整词及中文三字片段，空查询保持最近记录语义", () => {
    const terms = memoryCandidateTerms("请参考客户续约的历史经验");
    expect(terms).toContain("请参考客户续约的历史经验");
    expect(terms).toContain("客户续");
    expect(terms).toHaveLength(new Set(terms).size);
    expect(memoryCandidateTerms("，。 ")).toEqual([]);
  });

  it("显式内容来源不存在时不回退保存全部运行数据", () => {
    expect(buildMemoryContent({
      contentFrom: "missing_node",
      input: { customer: "甲公司" },
      outputs: { summary: "已完成" },
    })).toBeNull();
    expect(buildMemoryContent({
      contentFrom: "summary",
      input: {},
      outputs: { summary: "仅保存这一条" },
    })).toContain("仅保存这一条");
  });
});
