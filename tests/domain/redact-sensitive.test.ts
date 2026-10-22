import { describe, expect, it } from "vitest";
import { redactCredentialData, redactCredentialText, redactSensitiveData, redactSensitiveText, redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";

describe("敏感数据脱敏", () => {
  it("未带标签的公开工具凭据不会从普通文本流出，重复清理保持稳定", () => {
    const lower = "pat_" + "a".repeat(64), upper = "PAT_" + "B".repeat(64);
    const text = `处理记录（${lower}），补充 ${upper}。`;
    const expected = "处理记录（[已隐藏敏感信息]），补充 [已隐藏敏感信息]。";
    expect(redactCredentialText(text)).toBe(expected);
    expect(redactSensitiveText(text)).toBe(expected);
    expect(redactCredentialText(expected)).toBe(expected);
  });
  it("嵌套普通字段中的公开工具凭据被隐藏，业务值和源对象不变", () => {
    const key = "pat_" + "a".repeat(64);
    const value = { note: key, rows: [{ detail: `收到 ${key}` }], amount: 0, approved: false, inputTokens: 3 };
    const expected = { note: "[已隐藏敏感信息]", rows: [{ detail: "收到 [已隐藏敏感信息]" }], amount: 0, approved: false, inputTokens: 3 };
    expect(redactCredentialData(value)).toEqual(expected);
    expect(redactStructuredCredentialData(value)).toEqual(expected);
    expect(redactSensitiveData(value)).toEqual(expected);
    expect(value.note).toBe(key);
    expect(value.rows[0].detail).toBe(`收到 ${key}`);
  });
  it("不把工具标识或不符发放格式的普通文本误判为新凭据", () => {
    for (const value of ["public-tool:00000000-0000-4000-8000-000000000001", "pat_reference", "pat_" + "a".repeat(63), "pat_" + "g".repeat(64)]) {
      expect(redactCredentialText(value)).toBe(value);
    }
  });
  it("凭据作为普通字段名时省略整项，覆盖嵌套和数组且不改变源对象", () => {
    const lower = "pat_" + "a".repeat(64), upper = "PAT_" + "B".repeat(64);
    const value = { [lower]: "完成", rows: [{ detail: { [`记录（${upper}）`]: false, amount: 0 } }], approved: false, inputTokens: 3 };
    const original = JSON.stringify(value);
    const expected = { rows: [{ detail: { amount: 0 } }], approved: false, inputTokens: 3 };
    for (const redact of [redactCredentialData, redactStructuredCredentialData, redactSensitiveData]) {
      const safe = redact(value);
      expect(safe).toEqual(expected);
      expect(redact(safe)).toEqual(expected);
      expect(JSON.stringify(safe)).not.toMatch(/pat_[a-f0-9]{64}/i);
      expect(JSON.stringify(value)).toBe(original);
    }
  });
  it("省略凭据键不合并或覆盖安全字段，不误判不符发放格式的键", () => {
    const value = { ["pat_" + "a".repeat(64)]: "私密甲", ["pat_" + "b".repeat(64)]: "私密乙", "[已隐藏敏感信息]": "业务原值", ["pat_" + "c".repeat(63)]: 0, pat_reference: false };
    const expected = { "[已隐藏敏感信息]": "业务原值", ["pat_" + "c".repeat(63)]: 0, pat_reference: false };
    for (const redact of [redactCredentialData, redactStructuredCredentialData, redactSensitiveData]) {
      expect(redact(value)).toEqual(expected);
    }
  });
  it("结构化专用脱敏保留有界深层字段，但不改变普通上下文的旧层级限制", () => {
    let value: Record<string, unknown> = { amount: 0, apiKey: "private-deep-value" };
    for (let index = 0; index < 20; index += 1) value = { child: value };
    const original = JSON.stringify(value);
    expect(JSON.stringify(redactCredentialData(value))).toContain("已省略");
    const safe = JSON.stringify(redactStructuredCredentialData(value));
    expect(safe).not.toMatch(/private-deep-value|已省略/);
    expect(safe).toContain('"amount":0');
    expect(JSON.stringify(value)).toBe(original);
  });
  it("递归隐藏中英文敏感字段并保留业务数据", () => {
    expect(redactSensitiveData({
      customer: "甲公司",
      api_key: "sk-secret",
      nested: [{ authorization: "Bearer secret", result: "通过" }],
      身份证: "110101199001010000",
      contact: { email: "person@example.com", mobilePhone: "13800000000", address: "某市某路" },
      payment: { credit_card_number: "6222000000000000" },
    })).toEqual({
      customer: "甲公司",
      api_key: "[已隐藏敏感信息]",
      nested: [{ authorization: "[已隐藏敏感信息]", result: "通过" }],
      身份证: "[已隐藏敏感信息]",
      contact: {
        email: "[已隐藏敏感信息]",
        mobilePhone: "[已隐藏敏感信息]",
        address: "[已隐藏敏感信息]",
      },
      payment: { credit_card_number: "[已隐藏敏感信息]" },
    });
  });

  it("普通字段中的常见密钥与个人信息也会被隐藏", () => {
    expect(redactSensitiveData({
      note: "联系 person@example.com 或 13800000000，令牌：should-not-leak",
      log: "Authorization: Bearer abcdefghijklmnop and sk-abcdefghijklmnop",
      identity: "证件 110105199001011234，卡号 4111 1111 1111 1111",
      safe: "订单 202609250001，金额 138 元",
    })).toEqual({
      note: `联系 ${"[已隐藏敏感信息]"} 或 ${"[已隐藏敏感信息]"}，${"[已隐藏敏感信息]"}`,
      log: `${"[已隐藏敏感信息]"} and ${"[已隐藏敏感信息]"}`,
      identity: `证件 ${"[已隐藏敏感信息]"}，卡号 ${"[已隐藏敏感信息]"}`,
      safe: "订单 202609250001，金额 138 元",
    });
  });

  it("不会把运行标识和普通业务编号误判为银行卡号", () => {
    expect(redactSensitiveData({
      runId: "00000000-0000-4000-8000-000000000011",
      reference: "202609250001",
      usage: { inputTokens: 12, output_tokens: 6, totalTokens: 18 },
    })).toEqual({
      runId: "00000000-0000-4000-8000-000000000011",
      reference: "202609250001",
      usage: { inputTokens: 12, output_tokens: 6, totalTokens: 18 },
    });
  });

  it("可直接清理轨迹和错误中的敏感文本", () => {
    expect(redactSensitiveText("Authorization: Bearer abcdefghijklmnop")).toBe("[已隐藏敏感信息]");
  });

  it("隐藏带普通 token 标签的凭据", () => {
    const redacted = redactCredentialText("请求失败 token=secret-value");
    expect(redacted).toBe("请求失败 [已隐藏敏感信息]");
    expect(redacted).not.toContain("secret-value");
  });

  it("隐藏带标签的凭据时保留业务文本的结束标点", () => {
    expect(redactCredentialText("资料「authorization: Bearer abcdefghijklmnop」")).toBe("资料「[已隐藏敏感信息]」");
    expect(redactCredentialText("说明（访问令牌：abcdefghijklmnop）")).toBe("说明（[已隐藏敏感信息]）");
  });

  it("隐藏连接地址中的用户信息", () => {
    const value = redactCredentialText("连接 postgresql://service:private-password@db.example.com/app 失败");
    expect(value).toBe("连接 postgresql://[已隐藏敏感信息]@db.example.com/app 失败");
    expect(value).not.toContain("service");
    expect(value).not.toContain("private-password");
  });

  it("验收输入只隐藏凭据并保留业务联系信息", () => {
    expect(redactCredentialData({
      apiKey: "sk-abcdefghijklmnop",
      note: "Authorization: Bearer abcdefghijklmnop",
      email: "person@example.com",
      phone: "13800000000",
      address: "某市某路",
    })).toEqual({
      apiKey: "[已隐藏敏感信息]",
      note: "[已隐藏敏感信息]",
      email: "person@example.com",
      phone: "13800000000",
      address: "某市某路",
    });
  });
});
