export const MAX_DOCX_ENTRIES = 2_000;
export const MAX_DOCX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_MIN_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 65_535;

function findEndRecord(view: DataView): number {
  const first = Math.max(0, view.byteLength - END_MIN_BYTES - MAX_ZIP_COMMENT_BYTES);
  for (let offset = view.byteLength - END_MIN_BYTES; offset >= first; offset -= 1) {
    if (view.getUint32(offset, true) !== END_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + END_MIN_BYTES + commentLength === view.byteLength) return offset;
  }
  return -1;
}

export function validateDocxArchive(bytes: Uint8Array): string | null {
  if (bytes.byteLength < END_MIN_BYTES) return "DOCX 文件结构不完整，请重新导出后上传";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndRecord(view);
  if (endOffset < 0) return "DOCX 文件结构不完整，请重新导出后上传";

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
  if (centralEnd > endOffset || centralEnd > bytes.byteLength) {
    return "DOCX 文件结构不完整，请重新导出后上传";
  }

  let cursor = centralOffset;
  let uncompressedBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > centralEnd || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      return "DOCX 文件结构不完整，请重新导出后上传";
    }
    const declaredSize = view.getUint32(cursor + 24, true);
    if (declaredSize === 0xffffffff) {
      return "暂不支持 ZIP64 格式的 DOCX 文件，请重新导出后上传";
    }
    uncompressedBytes += declaredSize;
    if (uncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
      return "DOCX 解压后超过 64MB 限制，请精简图片或拆分后重新上传";
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor > centralEnd) return "DOCX 文件结构不完整，请重新导出后上传";
  return null;
}
