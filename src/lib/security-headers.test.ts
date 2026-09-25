import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "@/lib/security-headers";

describe("全站浏览器安全响应头", () => {
  it("阻止类型嗅探、页面嵌套和无关设备权限", () => {
    expect(Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key.toLowerCase(), value])))
      .toMatchObject({
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "x-robots-tag": "noindex, nofollow",
        "referrer-policy": "strict-origin-when-cross-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
      });
  });
});
