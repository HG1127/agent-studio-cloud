import { describe, expect, it, vi } from "vitest";
import { MAX_MCP_RESPONSE_BYTES, MAX_MCP_TEXT_BLOCKS } from "@/contracts/mcp-tool";
import { normalizeMcpToolResult } from "./mcp-tool";

const textSchema = { type: "object", required: ["text"], properties: { text: { type: "string" } }, additionalProperties: false };
const read = { operationKind: "read" as const };
const textResult = (text: string) => ({ content: [{ type: "text", text }] });

describe("MCP 已登记只读工具文本结果", () => {
  it("保留中文、空白和 Markdown 原文，不带入注解、不修改原结果", () => {
    const text = "\n# 查询结果\n\n甲客户：未成交。  \n";
    const result = { content: [{ type: "text", text, annotations: { audience: ["assistant"] }, metadata: "非正文" }] };
    const before = JSON.stringify(result);
    expect(normalizeMcpToolResult(result, textSchema, read)).toEqual({ ok: true, output: { text } });
    expect(JSON.stringify(result)).toBe(before);
  });
  it("多段文本按顺序以空行连接，不把片段合并成结构化业务字段", () => {
    const parts = ["第一段", "", '{"ok":true}', "末段\n"];
    expect(normalizeMcpToolResult({ content: parts.map((text) => ({ type: "text", text })) }, textSchema, read))
      .toEqual({ ok: true, output: { text: parts.join("\n\n") } });
  });
  it.each([[], [{ type: "text", text: "" }]].map((content) => ({ content })))("空查询结果不编造正文 %#", ({ content }) => {
    expect(normalizeMcpToolResult({ content }, textSchema, read)).toEqual({ ok: true, output: { text: "" } });
  });
  it.each(["0", "false", "null", "[]", '"资料"'])("非对象 JSON 保留为原文 %s", (text) => {
    expect(normalizeMcpToolResult(textResult(text), textSchema, read)).toEqual({ ok: true, output: { text } });
  });
  it.each([undefined, {}, { operationKind: "action" as const }, { operationKind: "read" as const, hasOutputDefinition: true }])("未知操作、写入及已声明结构化回执不能退回文字 %#", (context) => {
    expect(normalizeMcpToolResult(textResult("普通文字"), textSchema, context)).toMatchObject({ ok: false, retryable: false });
    expect(normalizeMcpToolResult({ content: [] }, textSchema, context).ok).toBe(false);
  });
  it("远端注解不能把未知操作变成已登记只读工具", () => {
    expect(normalizeMcpToolResult({ ...textResult("普通文字"), annotations: { readOnlyHint: true } }, textSchema).ok).toBe(false);
  });
  it("单段对象 JSON 保持旧结构化行为，写操作和声明回执均兼容", () => {
    for (const context of [read, { operationKind: "action" as const }, { ...read, hasOutputDefinition: true }]) {
      expect(normalizeMcpToolResult(textResult('{"id":"c1","amount":0,"active":false}'), { type: "object" }, context))
        .toEqual({ ok: true, output: { id: "c1", amount: 0, active: false } });
    }
  });
  it.each([null, [], false, 0, "无效结构化正文", { ok: false }, { text: 1 }, { id: "c1" }].map((structuredContent) => ({ structuredContent })))("存在无效结构化结果时不能用普通文本掩盖 %#", ({ structuredContent }) => {
    expect(normalizeMcpToolResult({ structuredContent, ...textResult("备用文字") }, textSchema, read)).toMatchObject({ ok: false, retryable: false });
  });
  it("有效结构化结果优先，忽略其备用文本", () => {
    expect(normalizeMcpToolResult({ structuredContent: { text: "真实结果" }, ...textResult("备用文字") }, textSchema, read))
      .toEqual({ ok: true, output: { text: "真实结果" } });
  });
  it.each(['{"ok":false}', '{"text":1}', '{"id":"c1"}', '{"__proto__":{}}'])("单段对象回执失败后不二次包装以绕过校验 %s", (text) => {
    expect(normalizeMcpToolResult(textResult(text), textSchema, read)).toMatchObject({ ok: false, retryable: false });
  });
  it("错误标记优先且不回显远端错误或元信息", () => {
    const result = normalizeMcpToolResult({ isError: true, ...textResult("fixture-private-secret") }, textSchema, read);
    expect(result).toEqual({ ok: false, retryable: false, error: "远端工具报告操作未完成" });
    expect(JSON.stringify(result)).not.toContain("fixture-private-secret");
  });
  it("文字适配仍受冻结字段契约约束，不能补造业务字段或跳过文字规则", () => {
    expect(normalizeMcpToolResult(textResult("资料"), { type: "object", required: ["id"] }, read).ok).toBe(false);
    expect(normalizeMcpToolResult(textResult("资料"), { ...textSchema, properties: { text: { type: "string", minLength: 3 } } }, read).ok).toBe(false);
  });
  it.each([undefined, null, {}, [{ type: "text", text: 1 }], [{ type: "image", data: "AA==", mimeType: "image/png" }],
    [{ type: "text", text: "部分正文" }, { type: "resource_link", uri: "https://fixture.example/private", name: "附件" }],
    [{ type: "audio", data: "AA==", mimeType: "audio/wav" }], [{ type: "resource", resource: { uri: "file:///private", text: "秘密" } }]].map((content) => ({ content })))("缺失及混合非文本内容明确失败，不丢弃附件 %#", ({ content }) => {
    const result = normalizeMcpToolResult(content === undefined ? {} : { content }, textSchema, read);
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(JSON.stringify(result)).not.toContain("fixture.example");
  });
  it("块数上限不裁剪，允许边界处的有序空文本", () => {
    const content = Array.from({ length: MAX_MCP_TEXT_BLOCKS }, () => ({ type: "text", text: "" }));
    expect(normalizeMcpToolResult({ content }, textSchema, read)).toEqual({ ok: true, output: { text: "\n\n".repeat(MAX_MCP_TEXT_BLOCKS - 1) } });
    expect(normalizeMcpToolResult({ content: [...content, { type: "text", text: "尾部" }] }, textSchema, read).ok).toBe(false);
  });
  it("保留纯文本 JSON 字节边界，UTF8、转义和元信息超限明确拒绝", () => {
    const content = [{ type: "text", text: "" }];
    content[0].text = "x".repeat(MAX_MCP_RESPONSE_BYTES - new TextEncoder().encode(JSON.stringify(content)).byteLength);
    expect(normalizeMcpToolResult({ content }, textSchema, read)).toEqual({ ok: true, output: { text: content[0].text } });
    for (const text of [`${content[0].text}x`, "汉".repeat(400_000), "\n".repeat(600_000)]) {
      expect(normalizeMcpToolResult(textResult(text), textSchema, read)).toMatchObject({ ok: false, retryable: false });
    }
    expect(normalizeMcpToolResult({ content: [{ type: "text", text: "短文", metadata: "汉".repeat(400_000) }] }, textSchema, read).ok).toBe(false);
  });
  it("不执行 getter、toJSON 或接受循环内容", () => {
    const getter = vi.fn(() => "秘密"), toJSON = vi.fn(() => textResult("秘密"));
    const cyclic: Record<string, unknown> = {}; cyclic.content = [cyclic];
    for (const result of [{ content: [{ type: "text", get text() { return getter(); } }] }, { ...textResult("资料"), toJSON }, cyclic]) {
      expect(normalizeMcpToolResult(result, textSchema, read).ok).toBe(false);
    }
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
});
