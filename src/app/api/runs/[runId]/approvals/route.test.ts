import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const list = vi.hoisted(() => vi.fn());
vi.mock("@/server/queries/run-approvals", () => ({ listRunApprovals: list }));
import { GET } from "./route";
const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const URL = `http://localhost/api/runs/${RUN}/approvals`;
const context = (runId = RUN) => ({ params: Promise.resolve({ runId }) });
beforeEach(() => { list.mockReset().mockResolvedValue({ ok: true, runId: RUN, items: [], nextCursor: null }); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());
describe("任务确认摘要有界列表", () => {
  it("默认20条摘要，不读取完整成果或内部凭据", async () => {
    const response = await GET(new Request(URL), context(RUN.toUpperCase()));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(list).toHaveBeenCalledWith(RUN, expect.any(String), { limit: 20 });
  });
  it("微秒游标和筛选完整传入查询", async () => {
    expect((await GET(new Request(`${URL}?limit=1&status=approved&before=2000-01-01T00%3A00%3A00.123456Z&beforeId=${ID}`), context())).status).toBe(200);
    expect(list).toHaveBeenCalledWith(RUN, expect.any(String), { limit: 1, status: "approved", before: "2000-01-01T00:00:00.123456Z", beforeId: ID });
  });
  it.each(["limit=0", "limit=51", "limit=1&limit=2", "status=unknown", "before=2000-01-01T00%3A00%3A00Z", `beforeId=${ID}`, `workspaceId=${ID}`])("非法、重复或不完整筛选拒绝 %s", async (query) => {
    expect((await GET(new Request(`${URL}?${query}`), context())).status).toBe(400); expect(list).not.toHaveBeenCalled();
  });
  it("任务不存在返回404，数据库不可用返回可重试503", async () => {
    list.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("private-database-error"));
    expect((await GET(new Request(URL), context())).status).toBe(404);
    const response = await GET(new Request(URL), context()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-database");
  });
  it("跨站与非法路径不进入查询", async () => {
    expect((await GET(new Request(URL, { headers: { "sec-fetch-site": "cross-site" } }), context())).status).toBe(403);
    expect((await GET(new Request(URL), context("bad"))).status).toBe(400); expect(list).not.toHaveBeenCalled();
  });
});
