import { describe, expect, it } from "vitest";
import { HealthResponse } from "./health";

describe("HealthResponse", () => {
  it("接受合法的健康检查响应", () => {
    const result = HealthResponse.safeParse({ ok: true, db: true, workflow: true });
    expect(result.success).toBe(true);
  });
  it("拒绝缺少 db 字段的响应", () => {
    const result = HealthResponse.safeParse({ ok: true, workflow: true });
    expect(result.success).toBe(false);
  });
});
