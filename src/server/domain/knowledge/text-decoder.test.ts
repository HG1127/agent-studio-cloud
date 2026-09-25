import { describe, expect, it } from "vitest";
import { decodeKnowledgeText } from "@/server/domain/knowledge/text-decoder";

describe("知识文本编码识别", () => {
  it("读取 UTF-8 并自动移除字节顺序标记", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("退款说明")]);

    expect(decodeKnowledgeText(bytes)).toEqual({ ok: true, text: "退款说明", encoding: "utf-8" });
  });

  it("读取带标记的 UTF-16LE 和 UTF-16BE", () => {
    const littleEndian = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]);
    const bigEndian = new Uint8Array([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87]);

    expect(decodeKnowledgeText(littleEndian)).toEqual({ ok: true, text: "中文", encoding: "utf-16le" });
    expect(decodeKnowledgeText(bigEndian)).toEqual({ ok: true, text: "中文", encoding: "utf-16be" });
  });

  it("拒绝损坏的 UTF-8，避免替换字符被静默入库", () => {
    expect(decodeKnowledgeText(new Uint8Array([0xe4, 0xb8]))).toEqual({
      ok: false,
      error: "文本文件编码无法识别，请另存为 UTF-8 后重新上传",
    });
  });
});
