import { describe, expect, it } from "vitest";
import { MAX_KNOWLEDGE_TEXT_CHARS, validateExtractedKnowledgeText } from "@/server/domain/knowledge/text-limits";

describe("知识文本抽取边界", () => {
  it("接受正常业务文本", () => {
    expect(validateExtractedKnowledgeText("退货政策：签收后七天内可申请退货。")).toBeNull();
  });

  it("拒绝空白文档", () => {
    expect(validateExtractedKnowledgeText(" \n\t ")).toContain("没有可提取");
  });

  it("拒绝解压或抽取后过大的文档", () => {
    expect(validateExtractedKnowledgeText("字".repeat(MAX_KNOWLEDGE_TEXT_CHARS + 1))).toContain("200 万字符");
  });
});
