import { afterEach, describe, expect, it, vi } from "vitest";
import { readSessionValue, removeSessionValue, writeSessionValue } from "@/lib/session-storage";

afterEach(() => vi.restoreAllMocks());

describe("标签页草稿存储降级", () => {
  it("浏览器拒绝存储访问时不影响主流程", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });

    expect(readSessionValue("draft")).toBeNull();
    expect(writeSessionValue("draft", "value")).toBe(false);
    expect(() => removeSessionValue("draft")).not.toThrow();
  });
});
