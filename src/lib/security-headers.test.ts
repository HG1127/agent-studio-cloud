import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "@/lib/security-headers";

describe("全站浏览器安全响应头", () => {
  it("强制 HTTPS 并阻止类型嗅探、页面嵌套和跨源资源复用", () => {
    expect(Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key.toLowerCase(), value])))
      .toMatchObject({
        "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "x-dns-prefetch-control": "off",
        "x-robots-tag": "noindex, nofollow",
        "referrer-policy": "strict-origin-when-cross-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-origin",
      });
  });
});
