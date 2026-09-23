// 移植旧系统 knowledgeStore.mjs chunks() 口径：1200 字符、重叠 160、优先在换行/句号对齐。
const SIZE = 1200;
const OVERLAP = 160;

export interface Chunk {
  index: number;
  content: string;
  charStart: number;
  charEnd: number;
}

export function chunkText(text: string): Chunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + SIZE, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const candidates = [window.lastIndexOf("\n"), window.lastIndexOf("。"), window.lastIndexOf(". ")];
      const breakAt = Math.max(...candidates);
      if (breakAt > SIZE / 2) end = start + breakAt + 1;
    }
    const content = clean.slice(start, end).trim();
    if (content) chunks.push({ index: chunks.length, content, charStart: start, charEnd: end });
    if (end >= clean.length) break;
    start = Math.max(end - OVERLAP, start + 1);
  }
  return chunks;
}
