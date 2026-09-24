import { describe, expect, it } from "vitest";
import { validateJsonObjectSchema } from "@/server/domain/json-schema";

describe("外部消息字段校验", () => {
  const schema = {
    type: "object",
    required: ["complete", "customer"],
    properties: {
      complete: { type: "boolean" },
      customer: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" }, score: { type: "number" } },
      },
      tags: { type: "array", items: { type: "string" } },
      state: { enum: ["ready", "cancelled"] },
    },
  };

  it("接受满足字段结构的消息", () => {
    expect(validateJsonObjectSchema({ complete: true, customer: { id: "c-1", score: 92 }, tags: ["重点"], state: "ready" }, schema)).toBeNull();
  });

  it("拒绝缺失、类型错误和枚举外的值", () => {
    expect(validateJsonObjectSchema({ complete: true }, schema)).toBe("消息.customer为必填字段");
    expect(validateJsonObjectSchema({ complete: "yes", customer: { id: "c-1" } }, schema)).toContain("消息.complete类型不正确");
    expect(validateJsonObjectSchema({ complete: true, customer: { id: "c-1" }, state: "unknown" }, schema)).toBe("消息.state不是允许的值");
  });
});
