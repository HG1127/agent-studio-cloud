import { describe, expect, it } from "vitest";
import { hasCrossSiteOrigin, hasSameOrigin } from "@/server/security/request-origin";

describe("浏览器请求来源", () => {
  it("允许同站浏览器请求和不携带来源的服务端请求", () => {
    expect(hasCrossSiteOrigin(new Request("https://studio.example/api/upload", {
      headers: { origin: "https://studio.example" },
    }))).toBe(false);
    expect(hasCrossSiteOrigin(new Request("https://studio.example/api/upload"))).toBe(false);
  });

  it("拒绝跨站来源和不透明来源", () => {
    expect(hasCrossSiteOrigin(new Request("https://studio.example/api/upload", {
      headers: { origin: "https://malicious.example" },
    }))).toBe(true);
    expect(hasCrossSiteOrigin(new Request("https://studio.example/api/upload", {
      headers: { origin: "null" },
    }))).toBe(true);
  });

  it("只有明确携带当前站点来源时才视为同源浏览器请求", () => {
    expect(hasSameOrigin(new Request("https://studio.example/api/upload", {
      headers: { origin: "https://studio.example" },
    }))).toBe(true);
    expect(hasSameOrigin(new Request("https://studio.example/api/upload"))).toBe(false);
    expect(hasSameOrigin(new Request("https://studio.example/api/upload", {
      headers: { origin: "https://malicious.example" },
    }))).toBe(false);
  });
});
