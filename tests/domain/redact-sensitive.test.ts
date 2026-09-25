import { describe, expect, it } from "vitest";
import { redactSensitiveData } from "@/server/domain/security/redact-sensitive";

describe("敏感数据脱敏", () => {
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
    })).toEqual({
      runId: "00000000-0000-4000-8000-000000000011",
      reference: "202609250001",
    });
  });
});
