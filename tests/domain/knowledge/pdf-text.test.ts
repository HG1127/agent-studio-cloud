import { describe, expect, it, vi } from "vitest";
import { MAX_KNOWLEDGE_TEXT_CHARS } from "@/server/domain/knowledge/text-limits";
import { extractBoundedPdfText } from "@/server/domain/knowledge/pdf-text";

function pdf(pages: Array<Array<{ str?: unknown; hasEOL?: unknown }>>) {
  const cleanup = vi.fn();
  const getPage = vi.fn(async (pageNumber: number) => ({
    getTextContent: async () => ({ items: pages[pageNumber - 1] ?? [] }),
    cleanup,
  }));
  return { document: { numPages: pages.length, getPage }, getPage, cleanup };
}

describe("PDF 有界文本提取", () => {
  it("逐页提取并保留换行结构", async () => {
    const { document, getPage, cleanup } = pdf([
      [{ str: "第一行", hasEOL: true }, { str: "第二行" }],
      [{ str: "下一页" }],
    ]);

    await expect(extractBoundedPdfText(document)).resolves.toBe("第一行\n第二行\n下一页");
    expect(getPage.mock.calls.map(([pageNumber]) => pageNumber)).toEqual([1, 2]);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("累计文本超限时立即停止后续页面", async () => {
    const { document, getPage, cleanup } = pdf([
      [{ str: "x".repeat(MAX_KNOWLEDGE_TEXT_CHARS + 1) }],
      [{ str: "不应读取" }],
    ]);

    await expect(extractBoundedPdfText(document)).rejects.toThrow("文件提取后的文字超过");
    expect(getPage).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
