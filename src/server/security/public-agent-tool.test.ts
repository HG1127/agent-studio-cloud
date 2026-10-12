import { afterEach, describe, expect, it, vi } from "vitest";
import { publicToolAdminAuthorized, publicToolBearer, publicToolBrowserRequestAllowed } from "./public-agent-tool";
afterEach(() => vi.unstubAllEnvs());
describe("公开工具凭据入口", () => {
  it("只有单一有界 Bearer 头可作为凭据，无查询/body/cookie 退路", () => {
    const token = "pat_" + "a".repeat(64), url = "https://tools.example/api/public-tools";
    expect(publicToolBearer(new Request(url, { headers: { authorization: "Bearer " + token } }))).toBe(token);
    for (const request of [new Request(url, { headers: { cookie: "token=" + token } }),
      new Request(url + "?token=" + token, { headers: { authorization: "Bearer " + token } }),
      new Request(url, { headers: { authorization: "Bearer " + token + ", Bearer " + token } })]) {
      expect(publicToolBearer(request)).toBeNull();
    }
  });
  it("管理配置缺失 fail closed，跨站浏览器阻止但允许服务器调用", () => {
    vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", "");
    expect(publicToolAdminAuthorized("test-admin-".repeat(4))).toBe(false);
    const url = "https://tools.example/api/public-tools";
    expect(publicToolBrowserRequestAllowed(new Request(url))).toBe(true);
    expect(publicToolBrowserRequestAllowed(new Request(url, { headers: { origin: "https://external.example" } }))).toBe(false);
  });
});
