import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validationMessage } from "@/server/domain/validation-message";

describe("校验错误文案", () => {
  it("优先返回契约提供的中文可行动提示", () => {
    const schema = z.object({
      value: z.string().superRefine((value, context) => {
        if (value.length > 2) context.addIssue({ code: "custom", message: "内容不能超过 2 个字" });
      }),
    });
    const parsed = schema.safeParse({ value: "过长内容" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(validationMessage(parsed.error, "填写不正确")).toBe("内容不能超过 2 个字");
  });

  it("Zod 默认英文错误不直接暴露给用户", () => {
    const parsed = z.object({ id: z.string().uuid() }).safeParse({ id: "bad" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(validationMessage(parsed.error, "信息不正确")).toBe("信息不正确");
  });
});
