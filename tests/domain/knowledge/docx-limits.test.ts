import { describe, expect, it } from "vitest";
import { buildDocxArchive } from "../../helpers/docx-archive";
import {
  MAX_DOCX_ENTRIES,
  MAX_DOCX_UNCOMPRESSED_BYTES,
  validateDocxArchive,
} from "@/server/domain/knowledge/docx-limits";

function archiveHeader(options: { entries?: number; uncompressedBytes?: number } = {}) {
  return buildDocxArchive(Array.from({ length: options.entries ?? 1 }, (_, index) => ({
    name: `word/part-${index}.xml`,
    content: Buffer.from("正文"),
    declaredSize: options.uncompressedBytes,
  })));
}

describe("DOCX 解压边界", () => {
  it("接受解压规模正常的归档", () => {
    expect(validateDocxArchive(archiveHeader())).toBeNull();
  });

  it("拒绝声明解压后超过 64MB 的归档", () => {
    expect(validateDocxArchive(archiveHeader({
      uncompressedBytes: MAX_DOCX_UNCOMPRESSED_BYTES + 1,
    }))).toContain("解压后超过 64MB");
  });

  it("拒绝文件项过多和结构不完整的归档", () => {
    expect(validateDocxArchive(archiveHeader({ entries: MAX_DOCX_ENTRIES + 1 }))).toContain("文件数量超过");
    expect(validateDocxArchive(new Uint8Array([1, 2, 3]))).toContain("结构不完整");
  });

  it.each([0, 8] as const)("接受使用压缩方式 %s 的真实归档", (method) => {
    expect(validateDocxArchive(buildDocxArchive([
      { name: "word/document.xml", content: Buffer.from("中文正文"), method },
    ]))).toBeNull();
  });

  it("接受流式写入的数据描述符和普通备注", () => {
    const archive = buildDocxArchive([
      { name: "word/document.xml", content: Buffer.from("中文正文"), dataDescriptor: true },
    ], "文档备注");
    expect(validateDocxArchive(archive)).toBeNull();
  });

  it.each([0, 1, 65_537])("拒绝伪造的解压大小 %s", (declaredSize) => {
    const archive = buildDocxArchive([
      { name: "word/document.xml", content: Buffer.alloc(65_536, 65), declaredSize },
    ]);
    expect(validateDocxArchive(archive)).toContain("实际解压");
  });

  it("未压缩文件同样核对实际大小", () => {
    const archive = buildDocxArchive([
      { name: "word/document.xml", content: Buffer.from("正文"), method: 0, declaredSize: 1 },
    ]);
    expect(validateDocxArchive(archive)).toContain("实际解压");
  });

  it.each([0, 1])("拒绝声明 %s 项但包含更多目录记录的归档", (declaredEntries) => {
    const archive = buildDocxArchive([
      { name: "word/document.xml", content: Buffer.from("正文") },
      { name: "word/styles.xml", content: Buffer.from("样式") },
    ]);
    archive.writeUInt16LE(declaredEntries, archive.length - 22 + 8);
    archive.writeUInt16LE(declaredEntries, archive.length - 22 + 10);
    expect(validateDocxArchive(archive)).toContain("结构不完整");
  });

  it("拒绝中央目录与结束记录之间的未声明数据", () => {
    const archive = archiveHeader();
    const endOffset = archive.length - 22;
    const tampered = Buffer.concat([archive.subarray(0, endOffset), Buffer.alloc(4), archive.subarray(endOffset)]);
    expect(validateDocxArchive(tampered)).toContain("结构不完整");
  });

  it("拒绝指向中央目录的本地文件偏移", () => {
    const archive = archiveHeader();
    const centralOffset = archive.readUInt32LE(archive.length - 22 + 16);
    archive.writeUInt32LE(centralOffset, centralOffset + 42);
    expect(validateDocxArchive(archive)).toContain("结构不完整");
  });

  it("拒绝超出文件数据区的压缩大小", () => {
    const archive = archiveHeader();
    const centralOffset = archive.readUInt32LE(archive.length - 22 + 16);
    archive.writeUInt32LE(archive.length, centralOffset + 20);
    expect(validateDocxArchive(archive)).toContain("结构不完整");
  });

  it("拒绝截断的中央目录文件名", () => {
    const archive = archiveHeader();
    const centralOffset = archive.readUInt32LE(archive.length - 22 + 16);
    archive.writeUInt16LE(0xffff, centralOffset + 28);
    expect(validateDocxArchive(archive)).toContain("结构不完整");
  });

  it("拒绝不支持的压缩方式和加密归档", () => {
    const unsupported = archiveHeader();
    const centralOffset = unsupported.readUInt32LE(unsupported.length - 22 + 16);
    unsupported.writeUInt16LE(99, centralOffset + 10);
    expect(validateDocxArchive(unsupported)).toContain("压缩方式");
    const encrypted = archiveHeader();
    encrypted.writeUInt16LE(1, centralOffset + 8);
    expect(validateDocxArchive(encrypted)).toContain("加密");
  });

  it("拒绝损坏的压缩流而不暴露底层错误", () => {
    const archive = archiveHeader();
    const dataOffset = 30 + archive.readUInt16LE(26);
    archive[dataOffset] = 0xff;
    expect(validateDocxArchive(archive)).toBe("DOCX 压缩内容损坏，请重新导出后上传");
  });

  it("拒绝备注中存在第二个结束记录的歧义归档", () => {
    const archive = buildDocxArchive([
      { name: "word/document.xml", content: Buffer.from("正文") },
    ], `备注PK\u0005\u0006${"x".repeat(22)}`);
    expect(validateDocxArchive(archive)).toContain("结构不完整");
  });

  it("支持非零起始位置的字节视图", () => {
    const archive = archiveHeader();
    const padded = Buffer.concat([Buffer.alloc(3), archive, Buffer.alloc(2)]);
    expect(validateDocxArchive(padded.subarray(3, -2))).toBeNull();
  });
});
