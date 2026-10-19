import { describe, expect, it, vi } from "vitest";
import { MAX_MCP_RESPONSE_BYTES, MAX_MCP_TEXT_BLOCKS, McpToolTextContent, McpToolTextOutput } from "./mcp-tool";

describe("MCP 只读文本共享契约", () => {
  it.each([[], [{ type: "text", text: "" }], [{ type: "text", text: "资料甲" }, { type: "text", text: "资料乙" }]].map((content) => ({ content })))("保留空值和有序文字 %#", ({ content }) => {
    expect(McpToolTextContent.parse(content)).toEqual(content);
  });
  it("只提取文字，不复制远端注解及未知元信息", () => {
    expect(McpToolTextContent.parse([{ type: "text", text: "原文", annotations: { audience: ["assistant"] }, unknown: "非正文" }]))
      .toEqual([{ type: "text", text: "原文" }]);
  });
  it.each([null, {}, [{ type: "image", data: "AA==", mimeType: "image/png" }], [{ type: "text", text: 1 }], [{ text: "缺类型" }], ["普通字符串"]].map((content) => ({ content })))("无效内容不伪装为文字 %#", ({ content }) => {
    expect(McpToolTextContent.safeParse(content).success).toBe(false);
  });
  it("内容块数量有界，边界值不截断", () => {
    const blocks = Array.from({ length: MAX_MCP_TEXT_BLOCKS }, () => ({ type: "text", text: "" }));
    expect(McpToolTextContent.parse(blocks)).toHaveLength(MAX_MCP_TEXT_BLOCKS);
    expect(McpToolTextContent.safeParse([...blocks, { type: "text", text: "" }]).success).toBe(false);
  });
  it("文本内容按实际 JSON 字节限制，包含元信息而非仅计算正文", () => {
    const content = [{ type: "text", text: "" }];
    content[0].text = "x".repeat(MAX_MCP_RESPONSE_BYTES - new TextEncoder().encode(JSON.stringify(content)).byteLength);
    expect(new TextEncoder().encode(JSON.stringify(content)).byteLength).toBe(MAX_MCP_RESPONSE_BYTES);
    expect(McpToolTextContent.parse(content)).toEqual(content);
    expect(McpToolTextContent.safeParse([{ type: "text", text: `${content[0].text}x` }]).success).toBe(false);
    expect(McpToolTextContent.safeParse([{ type: "text", text: "短文", metadata: "汉".repeat(400_000) }]).success).toBe(false);
  });
  it("不执行访问器、序列化代码或循环数据", () => {
    const getter = vi.fn(() => "secret"), toJSON = vi.fn(() => ({}));
    const cyclic: Record<string, unknown> = { type: "text", text: "原文" }; cyclic.metadata = cyclic;
    for (const value of [[{ type: "text", get text() { return getter(); } }], [{ type: "text", text: "原文", toJSON }], [cyclic]]) {
      expect(McpToolTextContent.safeParse(value).success).toBe(false);
    }
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it.each(["", "普通文本", "汉字\n换行"])("统一输出只有 text，原文不裁剪 %s", (text) => {
    expect(McpToolTextOutput.parse({ text })).toEqual({ text });
  });
  it.each([{}, { text: 1 }, { text: "原文", ok: true }, { text: "原文", content: [] }])("输出不接受缺失或附加字段 %#", (value) => {
    expect(McpToolTextOutput.safeParse(value).success).toBe(false);
  });
  it("归一输出仍按 UTF8 和 JSON 转义后的字节计量", () => {
    const text = "x".repeat(MAX_MCP_RESPONSE_BYTES - new TextEncoder().encode(JSON.stringify({ text: "" })).byteLength);
    expect(McpToolTextOutput.parse({ text })).toEqual({ text });
    for (const oversized of [`${text}x`, "汉".repeat(400_000), "\n".repeat(600_000)]) {
      expect(McpToolTextOutput.safeParse({ text: oversized }).success).toBe(false);
    }
  });
});
