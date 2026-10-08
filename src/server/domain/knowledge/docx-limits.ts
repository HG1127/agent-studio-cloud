import { inflateRawSync } from "node:zlib";

export const MAX_DOCX_ENTRIES = 2_000;
export const MAX_DOCX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_MIN_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 65_535;
const STRUCTURE_ERROR = "DOCX 文件结构不完整，请重新导出后上传";
const ACTUAL_SIZE_ERROR = "DOCX 实际解压大小与文件声明不一致，请重新导出后上传";

interface CompressedEntry {
  method: number;
  start: number;
  end: number;
  declaredSize: number;
}

function findEndRecord(view: DataView): number {
  const first = Math.max(0, view.byteLength - END_MIN_BYTES - MAX_ZIP_COMMENT_BYTES);
  for (let offset = view.byteLength - 4; offset >= first; offset -= 1) {
    if (view.getUint32(offset, true) !== END_SIGNATURE) continue;
    if (offset + END_MIN_BYTES > view.byteLength) return -1;
    const commentLength = view.getUint16(offset + 20, true);
    // 下游解析器只读取最后一个结束记录，预检不能选择备注内另一个记录。
    return offset + END_MIN_BYTES + commentLength === view.byteLength ? offset : -1;
  }
  return -1;
}

export function validateDocxArchive(bytes: Uint8Array): string | null {
  if (bytes.byteLength < END_MIN_BYTES) return STRUCTURE_ERROR;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndRecord(view);
  if (endOffset < 0) return STRUCTURE_ERROR;

  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    return "暂不支持分卷 DOCX 文件，请重新导出后上传";
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    return "暂不支持 ZIP64 格式的 DOCX 文件，请重新导出后上传";
  }
  if (totalEntries > MAX_DOCX_ENTRIES) {
    return `DOCX 内文件数量超过 ${MAX_DOCX_ENTRIES} 项，请精简后重新上传`;
  }
  const centralEnd = centralOffset + centralSize;
  if (centralEnd !== endOffset) return STRUCTURE_ERROR;

  let cursor = centralOffset;
  let uncompressedBytes = 0;
  const entries: CompressedEntry[] = [];
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > centralEnd || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      return STRUCTURE_ERROR;
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const declaredSize = view.getUint32(cursor + 24, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const diskStart = view.getUint16(cursor + 34, true);
    if (declaredSize === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff || diskStart === 0xffff) {
      return "暂不支持 ZIP64 格式的 DOCX 文件，请重新导出后上传";
    }
    if (diskStart !== 0) return "暂不支持分卷 DOCX 文件，请重新导出后上传";
    if (flags & 0x0041) return "暂不支持加密 DOCX 文件，请解密后重新上传";
    if (method !== 0 && method !== 8) return "暂不支持这种 DOCX 压缩方式，请重新导出后上传";
    uncompressedBytes += declaredSize;
    if (uncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
      return "DOCX 解压后超过 64MB 限制，请精简图片或拆分后重新上传";
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (cursor > centralEnd || localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      return STRUCTURE_ERROR;
    }
    if (view.getUint16(localOffset + 6, true) !== flags || view.getUint16(localOffset + 8, true) !== method) {
      return STRUCTURE_ERROR;
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > centralOffset) return STRUCTURE_ERROR;
    entries.push({ method, start, end, declaredSize });
  }
  if (cursor !== centralEnd) return STRUCTURE_ERROR;
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.start, entry.end);
    if (entry.method === 0) {
      if (compressed.byteLength !== entry.declaredSize) return ACTUAL_SIZE_ERROR;
      continue;
    }
    try {
      // 必须在解析器解压前验证实际输出，不能只相信可伪造的目录大小。
      const output = inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.declaredSize) });
      if (output.byteLength !== entry.declaredSize) return ACTUAL_SIZE_ERROR;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") {
        return ACTUAL_SIZE_ERROR;
      }
      return "DOCX 压缩内容损坏，请重新导出后上传";
    }
  }
  return null;
}
