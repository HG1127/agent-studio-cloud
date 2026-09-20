import { describe, expect, it } from "vitest";
import { HealthSchema } from "./health";

describe("HealthSchema", () => {
  it("接受合法的健康检查响应", () => {
    const result = HealthSchema.safeParse({ ok: true, db: true, workflow: true });
    expect(result.success).toBe(true);
  });
  it("拒绝缺少 db 字段的响应", () => {
    const result = HealthSchema.safeParse({ ok: true, workflow: true });
    expect(result.success).toBe(false);
  });
});
