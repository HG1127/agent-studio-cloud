import { describe, expect, it } from "vitest";
import { redactSensitiveData } from "@/server/domain/security/redact-sensitive";

describe("敏感数据脱敏", () => {
  it("递归隐藏中英文敏感字段并保留业务数据", () => {
    expect(redactSensitiveData({
      customer: "甲公司",
      api_key: "sk-secret",
      nested: [{ authorization: "Bearer secret", result: "通过" }],
      身份证: "110101199001010000",
    })).toEqual({
      customer: "甲公司",
      api_key: "[已隐藏敏感信息]",
      nested: [{ authorization: "[已隐藏敏感信息]", result: "通过" }],
      身份证: "[已隐藏敏感信息]",
    });
  });
});
