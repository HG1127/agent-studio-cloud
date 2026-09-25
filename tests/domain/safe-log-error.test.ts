import { describe, expect, it } from "vitest";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

describe("安全错误日志摘要", () => {
  it("隐藏错误消息中的凭据和个人信息且不输出堆栈", () => {
    const error = Object.assign(
      new Error("连接失败：postgresql://user:password@example.com/db，authorization: Bearer private-log-token，联系 person@example.com"),
      { code: "AUTH_sk-log-secret-value" },
    );
    error.stack = "stack with private-stack-token";

    const safe = safeErrorForLog(error);

    expect(JSON.stringify(safe)).not.toContain("private-log-token");
    expect(JSON.stringify(safe)).not.toContain("person@example.com");
    expect(JSON.stringify(safe)).not.toContain("private-stack-token");
    expect(safe).toMatchObject({ name: "Error", message: expect.stringContaining("[已隐藏敏感信息]") });
  });

  it("兼容非 Error 异常并限制日志字段长度", () => {
    const safe = safeErrorForLog({ message: `失败 ${"x".repeat(3_000)}`, code: 503, detail: "不会输出" });
    expect(safe.message.length).toBeLessThanOrEqual(2_000);
    expect(safe.code).toBe("503");
    expect(JSON.stringify(safe)).not.toContain("不会输出");
  });

  it("隐藏数据库查询文本和参数并保留嵌套错误码", () => {
    const error = Object.assign(
      new Error("Failed query: insert into agents values ($1)\nparams: 客户业务机密"),
      {
        name: "DrizzleQueryError",
        cause: { code: "23505", detail: "客户业务机密" },
      },
    );

    const safe = safeErrorForLog(error);

    expect(safe).toEqual({
      name: "DrizzleQueryError",
      message: "数据库操作失败",
      code: "23505",
    });
    expect(JSON.stringify(safe)).not.toContain("客户业务机密");
    expect(JSON.stringify(safe)).not.toContain("insert into");
  });
});
