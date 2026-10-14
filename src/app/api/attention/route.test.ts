import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/server/queries/attention", () => ({ listAttention: mocks.list }));
import { GET } from "./route";
const address = "http://localhost/api/attention";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ ok: true, items: [], nextCursor: null }); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());
describe("统一待处理只读接口", () => {
  it("只读取当前工作区默认20条，无缓存", async () => {
    const response = await GET(new Request(address));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, items: [], nextCursor: null });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, { limit: 20 });
  });
  it("原样保留微秒时间与三个游标字段", async () => {
    const before = "2026-10-08T12:00:00.000123Z";
    const query = new URLSearchParams({ before, beforeId: id.toUpperCase(), beforeKind: "run-failed", kind: "run-failed", agentId: id, limit: "2" });
    expect((await GET(new Request(`${address}?${query}`))).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, { before, beforeId: id, beforeKind: "run-failed", kind: "run-failed", agentId: id, limit: 2 });
  });
  it.each(["normal", "long-pending", "expected-overdue", "retry-expired", "unknown"])("%s 分类传入受保护查询", async (timingState) => {
    expect((await GET(new Request(`${address}?timingState=${timingState}`))).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, { timingState, limit: 20 });
  });
  it.each(["workspaceId=other", "limit=51", "limit=0", "limit=1&limit=2", "kind=bad", "kind=run-failed&kind=wait-event", `beforeId=${id}`, "beforeKind=run-failed", "runId=bad", "before=bad", "payload=hidden", "timingState=timeout", "timingState=normal&timingState=unknown"])("拒绝 %s，不读数据库", async (query) => {
    const response = await GET(new Request(`${address}?${query}`));
    expect(response.status).toBe(400); expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each([["origin", "https://other.example"], ["sec-fetch-site", "cross-site"]])("跨站来源 %s 不读数据库", async (key, value) => {
    expect((await GET(new Request(address, { headers: { [key]: value } }))).status).toBe(403); expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each(["throw", "invalid", "failure"])("%s 返回安全可重试结果而非空成功清单", async (kind) => {
    if (kind === "throw") mocks.list.mockRejectedValue(new Error("postgres://private apiKey=private-error"));
    else mocks.list.mockResolvedValue(kind === "invalid" ? { ok: true, items: [], nextCursor: { id } } : { ok: false, error: "private-error" });
    const response = await GET(new Request(address));
    expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("2"); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toMatch(/postgres|private-error/);
  });
});
