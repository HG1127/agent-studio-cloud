import { describe, expect, it } from "vitest";
import { type JsonStorageRecord } from "@/contracts/json";
import { MAX_RUN_RESULT_BYTES, RunResultValue } from "@/contracts/run";
import { redactCredentialData, redactRunResultData, redactSensitiveData, redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";

const HIDDEN = "[已隐藏敏感信息]";
function wrap(value: JsonStorageRecord, layers: number): JsonStorageRecord {
  for (let index = 0; index < layers; index++) value = { nested: value };
  return value;
}

describe("成果专用个人信息与凭据投影", () => {
  it.each(["object", "array"] as const)("%s 保留32层成果而继续隐藏深层个人信息与凭据", (shape) => {
    const business = { amount: 0, approved: false, empty: null, tokenizer: "业务分词器", tokenUnit: 0,
      inputTokens: 0, tokenBudget: 0, apiKey: "fixture-private-value", contact: "finance@example.com",
      mobile: "13800000000", address: "某市某路", note: "Bearer fixture-secret-123456789",
      ["pat_" + "a".repeat(64)]: "不能展示的字段名" };
    const layers = shape === "object" ? 31 : 29;
    const value = wrap(shape === "object" ? business : { rows: [business] }, layers), original = JSON.stringify(value);
    const safe = redactRunResultData(value);
    let current = safe as JsonStorageRecord;
    for (let index = 0; index < layers; index++) current = current.nested as JsonStorageRecord;
    const expected = { amount: 0, approved: false, empty: null, tokenizer: "业务分词器", tokenUnit: 0,
      inputTokens: 0, tokenBudget: 0, apiKey: HIDDEN, contact: HIDDEN, mobile: HIDDEN, address: HIDDEN, note: HIDDEN };
    expect(current).toEqual(shape === "object" ? expected : { rows: [expected] });
    expect(JSON.stringify(safe)).not.toMatch(/已省略|fixture-private|finance@example|13800000000|某市某路|fixture-secret|pat_[a-f0-9]{64}/);
    expect(RunResultValue.safeParse(safe).success).toBe(true);
    expect(redactRunResultData(safe)).toEqual(safe);
    expect(JSON.stringify(value)).toBe(original);
  });

  it.each([0, false, null, "", [], {}].map((value) => ({ value })))("根值 $value 保留且无副作用", ({ value }) => {
    expect(redactRunResultData(value)).toEqual(value);
  });

  it.each(["finance@example.com", "13800000000", "Bearer fixture-secret-123456789", "4111 1111 1111 1111"])("根文字仍隐藏常见敏感内容 %s", (value) => {
    expect(redactRunResultData(value)).toBe(HIDDEN);
  });

  it("与浅层原个人信息保护一致，省略秘密键不覆盖安全字段", () => {
    const value = { ["pat_" + "a".repeat(64)]: "私密", "[已隐藏敏感信息]": "业务原文", amount: 0,
      tokenizer: "算法", tokenUnit: 0, tokenizerEmail: "business-contact", tokenizationSecret: "opaque-value" };
    expect(redactRunResultData(value)).toEqual(redactSensitiveData(value));
    expect(redactRunResultData(value)).toEqual({ "[已隐藏敏感信息]": "业务原文", amount: 0,
      tokenizer: "算法", tokenUnit: 0, tokenizerEmail: HIDDEN, tokenizationSecret: HIDDEN });
  });

  it("不改变普通上下文12层和结构化仅凭据策略", () => {
    const value = wrap({ amount: 0, contact: "finance@example.com", apiKey: "fixture-private-value" }, 20);
    expect(JSON.stringify(redactSensitiveData(value))).toContain("已省略");
    expect(JSON.stringify(redactCredentialData(value))).toContain("已省略");
    expect(JSON.stringify(redactStructuredCredentialData(value))).toContain("finance@example.com");
    expect(JSON.stringify(redactRunResultData(value))).not.toMatch(/已省略|finance@example|fixture-private/);
  });

  it("完整两兆合法成果原样保留，不静默缩短业务正文", () => {
    const value = { amount: 0, approved: false, text: "" };
    value.text = "x".repeat(MAX_RUN_RESULT_BYTES - new TextEncoder().encode(JSON.stringify(value)).byteLength);
    expect(redactRunResultData(value)).toEqual(value);
  });

  it("脱敏占位符膨胀超限时明确拒绝，不裁剪或输出不合契约的部分成果", () => {
    const value = { apiKey: "", text: "" };
    value.text = "x".repeat(MAX_RUN_RESULT_BYTES - new TextEncoder().encode(JSON.stringify(value)).byteLength);
    expect(RunResultValue.safeParse(value).success).toBe(true);
    expect(() => redactRunResultData(value)).toThrow("脱敏成果超过安全展示范围");
    expect(value.apiKey).toBe("");
  });

  it("拒绝第33层历史数据，不用省略提示代替完整业务成果", () => {
    expect(() => redactRunResultData(wrap({ apiKey: "fixture-private-value" }, 32))).toThrow("保存的成果无法安全展示");
  });

  it("拒绝带getter的结果且不读取getter，不把校验错误暴露为原文", () => {
    let called = 0;
    const value = Object.defineProperty({ amount: 0 }, "detail", { enumerable: true, get: () => { called++; throw new Error("fixture-private-value"); } });
    expect(() => redactRunResultData(value)).toThrow("保存的成果无法安全展示");
    expect(called).toBe(0);
  });
});
