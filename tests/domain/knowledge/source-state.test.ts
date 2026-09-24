import { describe, expect, it } from "vitest";
import { processedKnowledgeStatus, restoredKnowledgeStatus } from "@/server/domain/knowledge/source-state";

describe("知识来源状态", () => {
  it("迟到的处理结果不会解除归档", () => {
    expect(processedKnowledgeStatus(new Date(), "indexed")).toBe("archived");
    expect(processedKnowledgeStatus(new Date(), "failed")).toBe("archived");
    expect(processedKnowledgeStatus(null, "indexed")).toBe("indexed");
  });

  it("恢复时按已有内容和错误回到正确状态", () => {
    expect(restoredKnowledgeStatus({ chunkCount: 2, error: null })).toBe("indexed");
    expect(restoredKnowledgeStatus({ chunkCount: 0, error: "解析失败" })).toBe("failed");
    expect(restoredKnowledgeStatus({ chunkCount: 0, error: null })).toBe("parsing");
  });
});
