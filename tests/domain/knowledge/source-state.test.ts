import { describe, expect, it } from "vitest";
import { isKnowledgeParsingStalled, processedKnowledgeStatus, restoredKnowledgeStatus } from "@/server/domain/knowledge/source-state";

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

  it("解析任务超过五分钟没有更新时判定为已中断", () => {
    const now = new Date("2026-09-25T12:10:00.000Z").getTime();
    expect(isKnowledgeParsingStalled({ status: "parsing", updatedAt: new Date("2026-09-25T12:04:59.999Z") }, now)).toBe(true);
    expect(isKnowledgeParsingStalled({ status: "parsing", updatedAt: new Date("2026-09-25T12:05:00.000Z") }, now)).toBe(false);
    expect(isKnowledgeParsingStalled({ status: "failed", updatedAt: new Date("2026-09-25T12:00:00.000Z") }, now)).toBe(false);
    expect(isKnowledgeParsingStalled({ status: "parsing" }, now)).toBe(false);
    expect(isKnowledgeParsingStalled({ status: "parsing", updatedAt: new Date("invalid") }, now)).toBe(false);
  });
});
