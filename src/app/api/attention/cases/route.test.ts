import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
const mocks = vi.hoisted(() => ({ list: vi.fn(), record: vi.fn() }));
vi.mock("@/server/queries/attention-cases", () => ({ listAttentionCases: mocks.list }));
vi.mock("@/server/actions/record-attention-handling", () => ({ recordAttentionHandlingAction: mocks.record }));
import { GET, POST } from "./route";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reference = { kind: "run-failed", id, runId: id, occurrence: "saved:failure" };
const input = { reference, action: "acknowledge", requestId: id, expectedRevision: 0, reason: "已核对" };
const now = "2026-10-09T00:00:00Z";
const item = { id, reference, title: "任务失败", status: "in-progress", revision: 1, createdAt: now, updatedAt: now, closedAt: null, sourceState: "active", entries: [{ requestId: id, action: "acknowledge", reason: "已核对", createdBy: id, createdAt: now }] };
function request(body: unknown = input, headers: Record<string, string> = {}) { return new Request("http://localhost/api/attention/cases", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ ok: true, items: [], nextCursor: null }); mocks.record.mockResolvedValue({ ok: true, recorded: true, item }); });
describe("集中处理历史与写入边界", () => {
  it("同源写入只经 Server Action，返回持久记录而非业务成功", async () => {
    const response = await POST(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(input); expect(await response.json()).toMatchObject({ ok: true, recorded: true, item: { sourceState: "active" } });
  });
  it.each<Record<string, string>>([{ origin: "https://other.example" }, { "sec-fetch-site": "cross-site" }, { origin: "" }])("跨站或缺少来源不执行写入", async (headers) => {
    expect((await POST(request(input, headers))).status).toBe(403); expect(mocks.record).not.toHaveBeenCalled();
  });
  it.each([{ ...input, workspaceId: id }, { ...input, expectedRevision: -1 }, { ...input, reason: " " }, { ...input, action: "close-resolved" }, { ...input, reason: "A".repeat(1001) }])("不完整、无界或缺少确认的请求不执行写入", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(mocks.record).not.toHaveBeenCalled();
  });
  it("正文类型、实际大小与错误编码均在写入前拒绝", async () => {
    expect((await POST(request(input, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request({ ...input, reason: "A".repeat(9000) }))).status).toBe(413);
    expect((await POST(new Request("http://localhost/api/attention/cases", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: new Uint8Array([255]) }))).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("业务冲突不宣称记录成功，未知结果要求沿用原请求", async () => {
    mocks.record.mockResolvedValue({ ok: false, error: "处理记录已变化" }); expect((await POST(request())).status).toBe(409);
    mocks.record.mockRejectedValue(new Error("postgres://operator:private-password"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(request()); expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("2"); expect(await response.text()).not.toContain("private-password"); error.mockRestore();
  });
  it("拒绝写入口返回另一来源记录，不回显不一致的业务信息", async () => {
    mocks.record.mockResolvedValue({ ok: true, recorded: true, item: { ...item, reference: { ...reference, occurrence: "other" } } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await POST(request())).status).toBe(503); error.mockRestore();
  });
  it("历史只读默认20条、限定当前工作区并不缓存", async () => {
    const response = await GET(new Request("http://localhost/api/attention/cases")); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, { limit: 20 });
  });
  it.each(["limit=51", "status=bad", "workspaceId=other", "limit=1&limit=2", `beforeId=${id}`])("历史非法筛选 %s 不访问数据库", async (query) => { expect((await GET(new Request(`http://localhost/api/attention/cases?${query}`))).status).toBe(400); expect(mocks.list).not.toHaveBeenCalled(); });
  it("历史跨站读取在查询前拒绝", async () => { expect((await GET(new Request("http://localhost/api/attention/cases", { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403); expect(mocks.list).not.toHaveBeenCalled(); });
});
