import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeQueryError, withSafeQueryError } from "@/server/security/query-error";

describe("withSafeQueryError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("返回查询结果", async () => {
    await expect(withSafeQueryError(async () => ({ ok: true }), "dashboard")).resolves.toEqual({ ok: true });
  });

  it("记录脱敏错误并只向上抛出固定消息", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unsafe = new Error("password=hunter2 token=secret-value");

    await expect(withSafeQueryError(async () => { throw unsafe; }, "dashboard"))
      .rejects.toEqual(expect.objectContaining({
        name: "SafeQueryError",
        message: "暂时无法读取数据，请稍后重试",
      }));

    expect(log).toHaveBeenCalledWith(
      "[query:dashboard] 读取失败",
      expect.objectContaining({ name: "Error" }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("hunter2");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-value");
  });

  it("不会把原始异常挂到安全异常上", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let caught: unknown;
    try {
      await withSafeQueryError(async () => { throw new Error("private"); }, "runs");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SafeQueryError);
    expect(caught).not.toHaveProperty("cause");
  });
});
