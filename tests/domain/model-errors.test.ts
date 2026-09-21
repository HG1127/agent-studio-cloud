// isTransientModelError 单测：瞬时错误（可重试）与配置类错误（不可重试）的分类，
// 分类口径移植自旧系统 modelGateway.mjs 的 transientModelError。
import { describe, expect, it } from "vitest";
import { isTransientModelError } from "@/lib/model";

describe("isTransientModelError", () => {
  it("HTTP 429 / 5xx 视为瞬时错误", () => {
    expect(isTransientModelError({ statusCode: 429, message: "rate limited" })).toBe(true);
    expect(isTransientModelError({ statusCode: 500, message: "internal error" })).toBe(true);
    expect(isTransientModelError({ statusCode: 503, message: "unavailable" })).toBe(true);
  });
  it("HTTP 4xx 配置类错误不重试", () => {
    expect(isTransientModelError({ statusCode: 401, message: "unauthorized" })).toBe(false);
    expect(isTransientModelError({ statusCode: 404, message: "model not found" })).toBe(false);
    expect(isTransientModelError({ statusCode: 400, message: "bad request" })).toBe(false);
  });
  it("网络类错误文案视为瞬时错误", () => {
    expect(isTransientModelError(new Error("fetch failed"))).toBe(true);
    expect(isTransientModelError(new Error("socket hang up"))).toBe(true);
    expect(isTransientModelError(new Error("连接超时"))).toBe(true);
    expect(isTransientModelError(new Error("request aborted: ECONNRESET"))).toBe(true);
  });
  it("普通错误不重试", () => {
    expect(isTransientModelError(new Error("invalid api key"))).toBe(false);
    expect(isTransientModelError(null)).toBe(false);
    expect(isTransientModelError(undefined)).toBe(false);
  });
});
