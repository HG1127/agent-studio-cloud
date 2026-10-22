import { describe, expect, it, vi } from "vitest";
import {
  MAX_PUBLIC_TOOL_RECEIPT_BYTES, PublicToolCallResult, PublicToolListResult, PublicToolManageResult, PublicToolReadResult,
} from "@/contracts/public-agent-tool";
import { PublicToolKeyManagementResult } from "@/contracts/public-tool-key-management";
import { publicToolTestView, PUBLIC_TOOL_TEST_IDS as ids } from "../../../tests/fixtures/public-agent-tool";
import { publicToolHttpCredential, publicToolHttpResponse, publicToolHttpUnavailable, readPublicToolHttpBody } from "./public-agent-tool-http";

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}
function callResult() {
  return PublicToolCallResult.parse({ ok: true, call: {
    toolId: ids.tool, requestId: ids.request, origin: "public-agent-tool", received: true, deliveryConfirmed: false,
    publicationId: ids.publication, version: 1, state: "accepted", resultAvailable: false, result: null, error: null,
    receivedAt: "2026-10-12T00:00:00.000Z", statusUrl: `/api/public-tools/${ids.tool}/calls/${ids.request}`,
  } });
}

describe("公开工具HTTP契约映射", () => {
  it.each([
    ["unauthorized", 401], ["invalid", 400], ["conflict", 409],
    ["not_found", 404], ["unavailable", 503], ["resource_limit", 429],
  ] as const)("失败%s保留契约正文与状态%s，不缓存", async (code, status) => {
    const result = { ok: false as const, code, error: "仅测试响应映射" };
    const response = publicToolHttpResponse(result);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(result);
    expectPrivateHeaders(response);
    expect(response.headers.get("www-authenticate")).toBe(status === 401 ? "Bearer" : null);
    expect(response.headers.get("retry-after")).toBeNull();
  });
  it.each([
    { name: "管理", status: 201, result: PublicToolManageResult.parse({ ok: true, tool: publicToolTestView(), recordedRevision: 2 }) },
    { name: "列表", status: 200, result: PublicToolListResult.parse({ ok: true, tools: [publicToolTestView()], truncated: false }) },
    { name: "读取", status: 200, result: PublicToolReadResult.parse({ ok: true, tool: publicToolTestView() }) },
    { name: "凭据元数据", status: 200, result: PublicToolKeyManagementResult.parse({
      ok: true, tool: publicToolTestView(), keys: [{ keyId: ids.key, name: "业务调用方", expiresAt: null,
        revokedAt: null, createdAt: "2026-10-12T00:00:00.000Z" }], truncated: false,
    }) },
    { name: "异步接收", status: 202, result: callResult() },
  ])("已有$name成功契约按$status返回，不添加业务或送达声明", async ({ result, status }) => {
    const response = publicToolHttpResponse(result, status);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(result);
    expectPrivateHeaders(response);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("retry-after")).toBeNull();
  });
  it("未确认操作保持安全503和有界重试提示", async () => {
    const response = publicToolHttpUnavailable();
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expectPrivateHeaders(response);
    await expect(response.json()).resolves.toEqual({ ok: false, code: "unavailable", error: "工具操作暂时无法确认，请沿用同一次请求核对", retryable: true });
  });
  it("联合类型不绕过真实容量和descriptor检查，不执行getter", async () => {
    const result = callResult();
    if (!result.ok) throw new Error("缺少契约样例");
    const getter = vi.fn(() => "不应读取");
    const oversized = publicToolHttpResponse({ ok: true, call: { ...result.call, result: { text: "x".repeat(MAX_PUBLIC_TOOL_RECEIPT_BYTES + 1) } } }, 202);
    const accessor = publicToolHttpResponse({ ok: true, tool: { ...publicToolTestView(), get description() { return getter(); } } });
    for (const response of [oversized, accessor]) {
      expect(response.status).toBe(503);
      expectPrivateHeaders(response);
      await expect(response.json()).resolves.toEqual({ ok: false, code: "unavailable", error: "工具回执超过容量或暂时无法确认" });
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it("使用真实Bearer/同源检查，不接受URL或跨站凭据退路", () => {
    const token = "pat_" + "a".repeat(64), url = "https://tools.example/api/public-tools";
    expect(publicToolHttpCredential(new Request(url, { headers: { authorization: "Bearer " + token } }))).toBe(token);
    for (const request of [
      new Request(url, { headers: { cookie: "token=" + token } }),
      new Request(url + "?token=" + token, { headers: { authorization: "Bearer " + token } }),
      new Request(url, { headers: { authorization: "Bearer " + token, origin: "https://external.example" } }),
      new Request(url, { headers: { authorization: "Bearer " + token, "sec-fetch-site": "cross-site" } }),
    ]) {
      const response = publicToolHttpCredential(request);
      if (typeof response === "string") throw new Error("凭据应被拒绝");
      expect(response.status).toBe(401);
      expectPrivateHeaders(response);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    }
  });
  it("原JSON读取保留真实UTF8边界和值类型", async () => {
    const text = JSON.stringify({ amount: 0, approved: false, label: "汉" });
    const maxBytes = new TextEncoder().encode(text).byteLength;
    const request = new Request("https://tools.example/api/public-tools", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: text });
    await expect(readPublicToolHttpBody(request, maxBytes)).resolves.toEqual({ ok: true, value: { amount: 0, approved: false, label: "汉" } });
  });
  it.each([
    { contentType: "text/plain", body: "{}", maxBytes: 100, status: 415, error: "工具请求必须使用 JSON 格式" },
    { contentType: "application/json", body: "{", maxBytes: 100, status: 400, error: "工具请求须为有效 JSON" },
    { contentType: "application/json", body: '{"text":"汉"}', maxBytes: 8, status: 413, error: "工具请求超过容量" },
  ])("正文原门禁$status不改变且不返回请求内容", async ({ contentType, body, maxBytes, status, error }) => {
    const result = await readPublicToolHttpBody(new Request("https://tools.example/api/public-tools", { method: "POST", headers: { "content-type": contentType }, body }), maxBytes);
    if (result.ok) throw new Error("正文应被拒绝");
    expect(result.response.status).toBe(status);
    expectPrivateHeaders(result.response);
    await expect(result.response.json()).resolves.toEqual({ ok: false, code: "invalid", error });
  });
});
