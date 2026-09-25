import { describe, expect, it } from "vitest";
import { createWaitEventToken, matchesWaitEventToken } from "@/server/security/wait-event-token";

describe("等待消息一次性凭据", () => {
  it("生成高熵且互不相同的 URL 安全凭据", () => {
    const first = createWaitEventToken();
    const second = createWaitEventToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("只接受完全一致的凭据", () => {
    const token = createWaitEventToken();

    expect(matchesWaitEventToken(token, token)).toBe(true);
    expect(matchesWaitEventToken(null, token)).toBe(false);
    expect(matchesWaitEventToken(`${token}x`, token)).toBe(false);
    expect(matchesWaitEventToken(token.slice(0, -1), token)).toBe(false);
  });
});
