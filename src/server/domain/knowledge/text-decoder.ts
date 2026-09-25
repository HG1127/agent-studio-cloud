export type KnowledgeTextEncoding = "utf-8" | "utf-16le" | "utf-16be";

export type KnowledgeTextDecodeResult =
  | { ok: true; text: string; encoding: KnowledgeTextEncoding }
  | { ok: false; error: string };

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

export function decodeKnowledgeText(bytes: Uint8Array): KnowledgeTextDecodeResult {
  const encoding: KnowledgeTextEncoding = hasPrefix(bytes, [0xff, 0xfe])
    ? "utf-16le"
    : hasPrefix(bytes, [0xfe, 0xff])
      ? "utf-16be"
      : "utf-8";
  try {
    return {
      ok: true,
      text: new TextDecoder(encoding, { fatal: true }).decode(bytes),
      encoding,
    };
  } catch {
    return {
      ok: false,
      error: "文本文件编码无法识别，请另存为 UTF-8 后重新上传",
    };
  }
}
