import { describe, expect, it } from "vitest";
import { chunkText } from "@/server/domain/knowledge/chunker";

describe("chunkText", () => {
  it("空文本与空白文本返回空数组", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("短文本产出单块且内容等于原文", () => {
    const chunks = chunkText("客户咨询后生成回复方案");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("客户咨询后生成回复方案");
    expect(chunks[0].index).toBe(0);
  });

  it("超长文本产出多块，每块不超过 1200 字符且相邻块有重叠", () => {
    const text = "这是用于测试切分的句子。".repeat(200); // 2400 字符
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(1200);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i].charStart).toBeLessThan(chunks[i - 1].charEnd);
    }
    expect(chunks.at(-1)?.charEnd).toBe(text.length);
    expect(chunks.reduce((sum, chunk) => sum + chunk.content.length, 0)).toBeGreaterThan(text.length);
  });

  it("优先在换行或句号处对齐切分", () => {
    const paragraph = "第一段落句子。".repeat(150) + "\n" + "第二段落句子。".repeat(150);
    const chunks = chunkText(paragraph);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.content.endsWith("\n")).toBe(false);
  });
});
