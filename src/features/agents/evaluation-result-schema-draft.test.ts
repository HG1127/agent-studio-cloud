import { describe, expect, it } from "vitest";
import { MAX_EVALUATION_RESULT_SCHEMA_BYTES } from "@/contracts/evaluation";
import { changeResultSchema, resultSchemaCheckSummary, resultSchemaPayload, resultSchemaSession, resultSchemaSource } from "@/features/agents/evaluation-result-schema-draft";

const schema = { type: "object", properties: { amount: { type: "number", minimum: 0 }, approved: { const: false } }, required: ["amount"] };

describe("验收结构规则的前端提交边界（纯函数）", () => {
  it("分别保留未提供、明确未设置、实际对象和不可解释来源", () => {
    expect(resultSchemaSource(undefined, false).kind).toBe("missing");
    expect(resultSchemaSource(undefined, true).kind).toBe("missing");
    expect(resultSchemaSource(null, true).kind).toBe("none");
    expect(resultSchemaSource(schema, true)).toEqual({ kind: "object", value: schema });
    expect(resultSchemaSource([], true).kind).toBe("unknown");
    expect(resultSchemaSource({ type: "array" }, true).kind).toBe("unknown");
  });
  it.each([undefined, null, schema, { type: "array" }])("未经修改的来源%j一律省略提交字段", (value) => {
    const session = resultSchemaSession(1, value, value !== undefined);
    expect(resultSchemaPayload(session)).toEqual({ ok: true, value: undefined });
    const opened = changeResultSchema(session, { generation: 1, revision: 0, operation: { kind: "begin" } })!;
    expect(resultSchemaPayload(opened)).toEqual({ ok: true, value: undefined });
    if (value === undefined || value === null) expect(opened.edit).toEqual({ kind: "keep", text: "" });
  });
  it("明确清除传null，替换保留合法规则中的0和false", () => {
    const session = resultSchemaSession(2, schema, true);
    const cleared = changeResultSchema(session, { generation: 2, revision: 0, operation: { kind: "clear" } })!;
    expect(resultSchemaPayload(cleared)).toEqual({ ok: true, value: null });
    const replacement = { ...schema, additionalProperties: false };
    const replaced = changeResultSchema(session, { generation: 2, revision: 0, operation: { kind: "replace", text: JSON.stringify(replacement) } })!;
    expect(resultSchemaPayload(replaced)).toEqual({ ok: true, value: replacement });
    expect(schema).not.toHaveProperty("additionalProperties");
  });
  it("取消只恢复本规则的省略提交语义，原规则不变", () => {
    const session = resultSchemaSession(3, schema, true);
    const replaced = changeResultSchema(session, { generation: 3, revision: 0, operation: { kind: "replace", text: "{" } })!;
    const cancelled = changeResultSchema(replaced, { generation: 3, revision: 1, operation: { kind: "cancel" } })!;
    expect(resultSchemaPayload(cancelled)).toEqual({ ok: true, value: undefined });
    expect(cancelled.source).toEqual(session.source);
  });
  it.each(["{", "", "null", "[]", '{"type":"array"}'])("非法编辑%s不转换成清除或示例规则", (text) => {
    const session = resultSchemaSession(4);
    const edited = changeResultSchema(session, { generation: 4, revision: 0, operation: { kind: "replace", text } })!;
    expect(resultSchemaPayload(edited).ok).toBe(false);
    expect(edited.edit).toEqual({ kind: "replace", text });
  });
  it("容量按UTF8字节限制，不能借中文字符数绕过32KB", () => {
    const session = resultSchemaSession(5);
    const text = JSON.stringify({ type: "object", description: "中".repeat(MAX_EVALUATION_RESULT_SCHEMA_BYTES / 2) });
    expect(text.length).toBeLessThan(MAX_EVALUATION_RESULT_SCHEMA_BYTES);
    const edited = changeResultSchema(session, { generation: 5, revision: 0, operation: { kind: "replace", text } })!;
    expect(resultSchemaPayload(edited)).toEqual({ ok: false, error: "结果结构规则不能超过32KB，请缩小内容后再保存" });
  });
  it("A到B再回A不会复活旧确认；重置同一样例也不能接受旧代次", () => {
    const original = resultSchemaSession(6, schema, true);
    const request = { generation: 6, revision: 0, operation: { kind: "clear" as const } };
    const b = changeResultSchema(original, { ...request, operation: { kind: "replace", text: '{"type":"object","required":["other"]}' } })!;
    const a = changeResultSchema(b, { generation: 6, revision: 1, operation: { kind: "replace", text: JSON.stringify(schema) } })!;
    expect(resultSchemaPayload(a)).toEqual({ ok: true, value: undefined });
    expect(changeResultSchema(a, request)).toBeNull();
    expect(changeResultSchema(resultSchemaSession(7, schema, true), request)).toBeNull();
  });
  it("结构规则不因零字段检查被声称只检查执行完成", () => {
    expect(resultSchemaCheckSummary(0, schema, true)).toBe("检查结果结构");
    expect(resultSchemaCheckSummary(0, null, true)).toBe("只检查流程是否成功完成");
    expect(resultSchemaCheckSummary(0, undefined, false)).toContain("信息未提供");
    expect(resultSchemaCheckSummary(0, [], true)).toContain("无法核对");
  });
});
