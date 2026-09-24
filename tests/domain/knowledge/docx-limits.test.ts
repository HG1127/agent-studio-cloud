import { describe, expect, it } from "vitest";
import {
  MAX_DOCX_ENTRIES,
  MAX_DOCX_UNCOMPRESSED_BYTES,
  validateDocxArchive,
} from "@/server/domain/knowledge/docx-limits";

function archiveHeader(options: { entries?: number; uncompressedBytes?: number } = {}) {
  const entries = options.entries ?? 1;
  const centralBytes = entries === 1 ? 46 : 0;
  const bytes = new Uint8Array(centralBytes + 22);
  const view = new DataView(bytes.buffer);
  if (entries === 1) {
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(24, options.uncompressedBytes ?? 1024, true);
  }
  const end = centralBytes;
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 8, entries, true);
  view.setUint16(end + 10, entries, true);
  view.setUint32(end + 12, centralBytes, true);
  view.setUint32(end + 16, 0, true);
  return bytes;
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
});
