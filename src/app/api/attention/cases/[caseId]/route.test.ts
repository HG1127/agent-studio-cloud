import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/server/queries/attention-cases", () => ({ getAttentionCase: mocks.get }));
import { GET } from "./route";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const now = "2026-10-09T00:00:00Z";
const item = { id, reference: { kind: "run-failed", id, runId: id, occurrence: "saved:failure" }, title: "失败任务", status: "in-progress", revision: 1, createdAt: now, updatedAt: now, closedAt: null, sourceState: "active", entries: [{ requestId: id, action: "acknowledge", reason: "已核对", createdBy: id, createdAt: now }] };
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue(item); });
describe("单条处理历史安全读取", () => {
  it("标识归一化、原记录归属校验与无缓存", async () => { const response = await GET(new Request(`http://localhost/api/attention/cases/${id}`), { params: Promise.resolve({ caseId: id.toUpperCase() }) }); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(mocks.get).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, id); });
  it("缺失记录返回404，不冒充空成功", async () => { mocks.get.mockResolvedValue(null); expect((await GET(new Request(`http://localhost/api/attention/cases/${id}`), { params: Promise.resolve({ caseId: id }) })).status).toBe(404); });
  it.each(["bad", id])("非法标识或未知查询在读取前拒绝", async (caseId) => { expect((await GET(new Request(`http://localhost/api/attention/cases/${caseId}?workspaceId=other`), { params: Promise.resolve({ caseId }) })).status).toBe(400); expect(mocks.get).not.toHaveBeenCalled(); });
  it("跨站读取拒绝，坏元数据或归属不一致安全失败", async () => {
    expect((await GET(new Request(`http://localhost/api/attention/cases/${id}`, { headers: { origin: "https://other.example" } }), { params: Promise.resolve({ caseId: id }) })).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ ...item, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }); const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await GET(new Request(`http://localhost/api/attention/cases/${id}`), { params: Promise.resolve({ caseId: id }) })).status).toBe(503); error.mockRestore();
  });
});
