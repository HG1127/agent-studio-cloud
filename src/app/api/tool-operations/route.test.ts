import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/server/queries/tool-operations", () => ({ listToolOperations: mocks.list }));
import { GET } from "./route";
const URL = "http://localhost/api/tool-operations";
const ID = "00000000-0000-4000-8000-000000000131";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ ok: true, items: [], nextCursor: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());
describe("业务核对列表接口", () => {
  it("默认有界查询当前工作区，不缓存列表", async () => {
    const response = await GET(new Request(URL));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, items: [], nextCursor: null });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, { limit: 20 });
  });
  it("按状态和首次来源运行筛选，保留微秒翻页时间", async () => {
    const before = "2026-10-08T12:00:00.000123Z";
    const query = new URLSearchParams({ status: "blocked", sourceRunId: ID, limit: "2", before, beforeId: ID });
    expect((await GET(new Request(`${URL}?${query}`))).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, { status: "blocked", sourceRunId: ID, limit: 2, before, beforeId: ID });
  });
  it.each([
    "limit=0", "limit=51", "limit=1.5", "limit=bad", "status=unknown", "sourceRunId=bad",
    "before=2026-10-08T12%3A00%3A00Z", `beforeId=${ID}`, "before=bad&beforeId=bad",
    "workspaceId=other", "limit=1&limit=2", "status=pending&status=blocked",
  ])("无效参数 %s 不读数据库", async (query) => {
    expect((await GET(new Request(`${URL}?${query}`))).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("跨站请求不读数据库", async () => {
    expect((await GET(new Request(URL, { headers: { origin: "https://other.example" } }))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("异常不泄露数据库连接或密钥", async () => {
    mocks.list.mockRejectedValue(new Error("postgres://private sk-private-key-123456"));
    const response = await GET(new Request(URL));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/postgres|sk-private/);
  });
  it("拒绝不符合共享契约的翻页结果", async () => {
    mocks.list.mockResolvedValue({ ok: true, items: [], nextCursor: { id: ID, createdAt: "bad" } });
    expect((await GET(new Request(URL))).status).toBe(500);
  });
});
