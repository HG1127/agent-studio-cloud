import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/server/actions/read-public-tool-keys", () => ({ readPublicToolKeysAction: mocks.read }));
import { GET } from "./route";
import { publicToolTestView, PUBLIC_TOOL_TEST_IDS as ids } from "../../../../../../tests/fixtures/public-agent-tool";

const origin = "https://tools.example", admin = "keys-test-admin-".repeat(3), caller = "pat_" + "a".repeat(64);
const view = { tool: publicToolTestView(), keys: [{ keyId: ids.key, name: "业务调用方", expiresAt: null, revokedAt: null,
  createdAt: "2026-10-12T00:00:00.000Z" }], truncated: false };
const context = (toolId = ids.tool) => ({ params: Promise.resolve({ toolId }) });
function request(headers: Record<string, string> = {}, suffix = "") {
  return new Request(origin + "/api/public-tools/" + ids.tool + "/keys" + suffix, { headers: { authorization: "Bearer " + admin, ...headers } });
}
beforeEach(() => { mocks.read.mockReset().mockResolvedValue({ ok: true, ...view }); vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", admin); });
afterEach(() => vi.unstubAllEnvs());
describe("管理员工具凭据读取 HTTP", () => {
  it("匿名、cookie、查询凭据、跨站和调用密钥均在动作前拒绝", async () => {
    const requests = [request({ authorization: "" }), request({ authorization: "", cookie: "token=" + admin }),
      request({}, "?token=never-query"), request({ origin: "https://other.example" }),
      request({ "sec-fetch-site": "cross-site" }), request({ authorization: "Bearer " + caller })];
    for (const req of requests) {
      const response = await GET(req, context());
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("管理员配置缺失或误用调用密钥时关闭入口", async () => {
    vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", "");
    expect((await GET(request(), context())).status).toBe(401);
    vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", caller);
    expect((await GET(request({ authorization: "Bearer " + caller }), context())).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("服务端及同源管理员读到安全详情，无缓存和 CORS", async () => {
    for (const req of [request(), request({ origin })]) {
      const response = await GET(req, context(ids.tool.toUpperCase()));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(await response.json()).toEqual({ ok: true, ...view });
    }
    expect(mocks.read).toHaveBeenCalledWith(admin, { toolId: ids.tool });
  });
  it("非法路径不进入动作，不存在工具保持404", async () => {
    expect((await GET(request(), context("invalid"))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.read.mockResolvedValueOnce({ ok: false, code: "not_found", error: "找不到这个工具" });
    expect((await GET(request(), context())).status).toBe(404);
  });
  it("读取失败及非法回执只返回503固定错误，不输出原异常或秘密字段", async () => {
    mocks.read.mockRejectedValueOnce(new Error("password=never-return-private"));
    const failed = await GET(request(), context());
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await failed.json())).not.toContain("never-return-private");
    mocks.read.mockResolvedValueOnce({ ok: true, ...view, tokenHash: "private-hash" });
    const malformed = await GET(request(), context());
    expect(malformed.status).toBe(503);
    expect(JSON.stringify(await malformed.json())).not.toContain("private-hash");
  });
});
