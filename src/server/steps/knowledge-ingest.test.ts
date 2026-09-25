import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_KNOWLEDGE_FILE_BYTES, MAX_KNOWLEDGE_PDF_PAGES } from "@/server/domain/knowledge/text-limits";

const mocks = vi.hoisted(() => ({
  extractText: vi.fn(),
  extractRawText: vi.fn(),
  getDocumentProxy: vi.fn(),
}));

vi.mock("unpdf", () => ({
  extractText: mocks.extractText,
  getDocumentProxy: mocks.getDocumentProxy,
}));
vi.mock("mammoth", () => ({ default: { extractRawText: mocks.extractRawText } }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { parseKnowledgeFile, readKnowledgeFile } from "@/server/steps/knowledge-ingest";

describe("知识文件解析防线", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("流式读取正常大小的文件", async () => {
    const content = new Blob(["退货政策"]).stream();
    const buffer = await readKnowledgeFile(content);
    expect(buffer.toString("utf8")).toBe("退货政策");
  });

  it("读取过程中立即拒绝超过 4MB 的文件", async () => {
    const content = new Blob([
      new Uint8Array(MAX_KNOWLEDGE_FILE_BYTES),
      new Uint8Array([1]),
    ]).stream();

    await expect(readKnowledgeFile(content)).rejects.toThrow("文件超过 4MB 限制");
  });

  it("在抽取文字前拒绝页数过多的 PDF", async () => {
    const cleanup = vi.fn();
    mocks.getDocumentProxy.mockResolvedValue({ numPages: MAX_KNOWLEDGE_PDF_PAGES + 1, cleanup });

    await expect(parseKnowledgeFile({
      sourceId: "source-1",
      filename: "超长资料.pdf",
      mime: "application/pdf",
      content: new Blob(["fake-pdf"]).stream(),
    })).rejects.toThrow(`PDF 超过 ${MAX_KNOWLEDGE_PDF_PAGES} 页限制`);
    expect(mocks.extractText).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("在调用解析器前拒绝结构异常的 DOCX", async () => {
    await expect(parseKnowledgeFile({
      sourceId: "source-1",
      filename: "异常资料.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: new Blob(["not-a-zip"]).stream(),
    })).rejects.toThrow("DOCX 文件结构不完整");
    expect(mocks.extractRawText).not.toHaveBeenCalled();
  });

  it("HTML 资料只把可见正文写入资料库", async () => {
    const result = await parseKnowledgeFile({
      sourceId: "source-1",
      filename: "帮助中心.html",
      mime: "text/html",
      content: new Blob(["<style>.secret{display:none}</style><h1>退款说明</h1><p>到账需要 1&ndash;3 天。</p><script>不要收录</script>"]).stream(),
    });

    expect(result.text).toBe("退款说明\n到账需要 1–3 天。");
  });
});
