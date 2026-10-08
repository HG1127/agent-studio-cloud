import { beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
import { MAX_KNOWLEDGE_FILE_BYTES, MAX_KNOWLEDGE_PDF_PAGES } from "@/server/domain/knowledge/text-limits";
import { buildDocxArchive } from "../../../tests/helpers/docx-archive";
import { buildTextPdf } from "../../../tests/helpers/pdf-document";

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
    mocks.extractRawText.mockReset();
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

  it.each(["FatalError", "RetryableError"] as const)("文件读取保留跨运行时的 %s", async (name) => {
    const failure = Object.assign(new Error("读取暂时失败"), {
      name,
      [name === "FatalError" ? "fatal" : "retryable"]: true,
    });
    expect(name === "FatalError" ? FatalError.is(failure) : RetryableError.is(failure)).toBe(true);
    const content = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(failure); },
    });

    await expect(parseKnowledgeFile({
      sourceId: "source-1", filename: "资料.txt", mime: "text/plain", content,
    })).rejects.toBe(failure);
  });

  it("在抽取文字前拒绝页数过多的 PDF", async () => {
    const destroy = vi.fn();
    mocks.getDocumentProxy.mockResolvedValue({ numPages: MAX_KNOWLEDGE_PDF_PAGES + 1, loadingTask: { destroy } });

    await expect(parseKnowledgeFile({
      sourceId: "source-1",
      filename: "超长资料.pdf",
      mime: "application/pdf",
      content: new Blob(["fake-pdf"]).stream(),
    })).rejects.toThrow(`PDF 超过 ${MAX_KNOWLEDGE_PDF_PAGES} 页限制`);
    expect(mocks.extractText).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each(["同步", "异步"])("文档销毁%s失败不覆盖已经解析的 PDF 正文", async (mode) => {
    const cleanup = vi.fn();
    const destroy = vi.fn(() => {
      if (mode === "同步") throw new Error("destroy customer-secret-value");
      return Promise.reject(new Error("destroy customer-secret-value"));
    });
    mocks.getDocumentProxy.mockResolvedValue({
      numPages: 1, loadingTask: { destroy },
      getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "退款说明" }] }), cleanup }),
    });
    await expect(parseKnowledgeFile({
      sourceId: "source-1", filename: "退款说明.pdf", mime: "application/pdf",
      content: new Blob(["fake-pdf"]).stream(),
    })).resolves.toEqual({ text: "退款说明" });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("文档销毁同步失败不覆盖页数超限的安全错误", async () => {
    const destroy = vi.fn(() => { throw new Error("destroy customer-secret-value"); });
    mocks.getDocumentProxy.mockResolvedValue({ numPages: MAX_KNOWLEDGE_PDF_PAGES + 1, loadingTask: { destroy } });
    await expect(parseKnowledgeFile({
      sourceId: "source-1", filename: "超长资料.pdf", mime: "application/pdf",
      content: new Blob(["fake-pdf"]).stream(),
    })).rejects.toThrow(`PDF 超过 ${MAX_KNOWLEDGE_PDF_PAGES} 页限制`);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("正文读取失败时仍销毁文档且不泄漏底层异常", async () => {
    const destroy = vi.fn();
    mocks.getDocumentProxy.mockResolvedValue({
      numPages: 1, loadingTask: { destroy },
      getPage: async () => { throw new Error("invalid page customer-secret-value"); },
    });
    await expect(parseKnowledgeFile({
      sourceId: "source-1", filename: "损坏资料.pdf", mime: "application/pdf",
      content: new Blob(["fake-pdf"]).stream(),
    })).rejects.toMatchObject({ message: "PDF 文件解析失败，请检查文件是否完整" });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("真实 PDF 解析完成后销毁加载任务", async () => {
    const actualUnpdf = await vi.importActual<typeof import("unpdf")>("unpdf");
    const bytes = buildTextPdf("Refund policy");
    const document = await actualUnpdf.getDocumentProxy(new Uint8Array(bytes));
    const destroy = vi.spyOn(document.loadingTask, "destroy");
    mocks.getDocumentProxy.mockResolvedValue(document);
    try {
      await expect(parseKnowledgeFile({
        sourceId: "source-1", filename: "退款说明.pdf", mime: "application/pdf",
        content: new Blob([bytes]).stream(),
      })).resolves.toEqual({ text: "Refund policy" });
      expect(destroy).toHaveBeenCalledOnce();
      expect(document.loadingTask.destroyed).toBe(true);
    } finally {
      await document.loadingTask.destroy();
    }
  });

  it("不把 PDF 解析器的原始异常带入工作流日志", async () => {
    mocks.getDocumentProxy.mockRejectedValue(new Error("invalid pdf contains customer-secret-value"));

    await expect(parseKnowledgeFile({
      sourceId: "source-1",
      filename: "损坏资料.pdf",
      mime: "application/pdf",
      content: new Blob(["fake-pdf"]).stream(),
    })).rejects.toMatchObject({ message: "PDF 文件解析失败，请检查文件是否完整" });
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

  it("在调用解析器前拒绝伪造解压大小的 DOCX", async () => {
    const archive = buildDocxArchive([
      { name: "word/document.xml", content: Buffer.alloc(65_536, 65), declaredSize: 1 },
    ]);
    await expect(parseKnowledgeFile({
      sourceId: "source-1", filename: "伪造资料.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: new Blob([new Uint8Array(archive)]).stream(),
    })).rejects.toThrow("DOCX 实际解压大小与文件声明不一致");
    expect(mocks.extractRawText).not.toHaveBeenCalled();
  });

  it("不允许未计入目录数量的文件交给解析器", async () => {
    const archive = buildDocxArchive([
      { name: "word/document.xml", content: Buffer.from("正文") },
    ]);
    archive.writeUInt16LE(0, archive.length - 22 + 8);
    archive.writeUInt16LE(0, archive.length - 22 + 10);
    await expect(parseKnowledgeFile({
      sourceId: "source-1", filename: "伪造目录.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: new Blob([new Uint8Array(archive)]).stream(),
    })).rejects.toThrow("DOCX 文件结构不完整");
    expect(mocks.extractRawText).not.toHaveBeenCalled();
  });

  it.each([0, 8] as const)("使用真实解析器读取压缩方式 %s 的普通 DOCX", async (method) => {
    const actualMammoth = await vi.importActual<typeof import("mammoth")>("mammoth");
    mocks.extractRawText.mockImplementation(actualMammoth.extractRawText);
    const archive = buildDocxArchive([
      { name: "[Content_Types].xml", method, content: Buffer.from(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ) },
      { name: "_rels/.rels", method, dataDescriptor: true, content: Buffer.from(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ) },
      { name: "word/document.xml", method, content: Buffer.from(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>退款说明</w:t></w:r></w:p><w:p><w:r><w:t>到账需要三天。</w:t></w:r></w:p></w:body></w:document>',
      ) },
    ]);
    const result = await parseKnowledgeFile({
      sourceId: "source-1", filename: "退款说明.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: new Blob([new Uint8Array(archive)]).stream(),
    });
    expect(result.text.trim()).toBe("退款说明\n\n到账需要三天。");
    expect(mocks.extractRawText).toHaveBeenCalledOnce();
  });

  it("不把 DOCX 解析器的原始异常带入工作流日志", async () => {
    const validDocxHeader = new Uint8Array(22);
    validDocxHeader.set([0x50, 0x4b, 0x05, 0x06]);
    mocks.extractRawText.mockRejectedValue(new Error("zip entry customer-secret-value"));

    await expect(parseKnowledgeFile({
      sourceId: "source-1",
      filename: "损坏资料.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: new Blob([validDocxHeader]).stream(),
    })).rejects.toMatchObject({ message: "DOCX 文件解析失败，请检查文件是否完整" });
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

  it("文本编码损坏时明确失败而不是把乱码写入资料库", async () => {
    await expect(parseKnowledgeFile({
      sourceId: "source-1",
      filename: "损坏资料.txt",
      mime: "text/plain",
      content: new Blob([new Uint8Array([0xe4, 0xb8])]).stream(),
    })).rejects.toThrow("请另存为 UTF-8 后重新上传");
  });
});
