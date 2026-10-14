import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTION_RESOURCE_LIMITS, ExecutionPolicyReadResult, ExecutionPolicyWriteResult, MAX_EXECUTION_POLICY_REQUEST_BYTES } from "@/contracts/execution-resources";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), history: vi.fn() }));
vi.mock("@/server/queries/execution-resources", () => ({ getExecutionResourcePolicy: mocks.read, listExecutionPolicyHistory: mocks.history }));
vi.mock("@/server/actions/record-execution-policy", () => ({ recordExecutionPolicyAction: mocks.write }));
import { GET, POST } from "./route";
import { GET as history } from "./history/route";
const origin = "http://localhost", url = `${origin}/api/execution/resources`, id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", time = "2026-10-09T12:00:00.000Z";
const input = { requestId: id, expectedRevision: 0, confirmed: true, limits: DEFAULT_EXECUTION_RESOURCE_LIMITS, reason: "试点上限" };
const policy = { revision: 1, source: "configured", limits: DEFAULT_EXECUTION_RESOURCE_LIMITS, updatedAt: time };
const snapshot = { policy, capacity: { reservedChains: 1, untrackedActiveRuns: 1, availableSlots: 49 }, assessedAt: time };
const request = (body: unknown = input, requestOrigin: string | null = origin, contentType = "application/json") => new Request(url, { method: "POST", headers: { "content-type": contentType, ...(requestOrigin ? { origin: requestOrigin } : {}) }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(snapshot); mocks.write.mockResolvedValue({ ok: true, recordedRevision: 1, policy }); mocks.history.mockResolvedValue({ ok: true, items: [], nextBeforeRevision: null }); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());
describe("资源设置受保护部署接口", () => {
  it("只读当前工作区容量与设置，响应无缓存", async () => {
    const response = await GET(new Request(url)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(ExecutionPolicyReadResult.parse(await response.json())).toEqual({ ok: true, snapshot }); expect(mocks.read).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(["?workspaceId=x", "?limit=1"])("当前设置查询拒绝参数 %s", async (query) => { expect((await GET(new Request(url + query))).status).toBe(400); expect(mocks.read).not.toHaveBeenCalled(); });
  it("读请求跨站拒绝，历史严格验证未知与重复参数", async () => {
    expect((await GET(new Request(url, { headers: { origin: "https://foreign.example" } }))).status).toBe(403);
    for (const query of ["?workspaceId=x", "?limit=1&limit=2", "?beforeRevision=0", "?limit=51"]) expect((await history(new Request(url + "/history" + query))).status).toBe(400);
    expect(mocks.history).not.toHaveBeenCalled();
    expect((await history(new Request(url + "/history?limit=2&beforeRevision=4"))).status).toBe(200);
    expect(mocks.history).toHaveBeenCalledWith(DEMO_WORKSPACE_ID, { limit: 2, beforeRevision: 4 });
  });
  it("写入只经过 Server Action，原设置回执与新版本都按共享契约", async () => {
    const response = await POST(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(ExecutionPolicyWriteResult.parse(await response.json())).toEqual({ ok: true, recordedRevision: 1, policy }); expect(mocks.write).toHaveBeenCalledExactlyOnceWith(input);
    mocks.write.mockResolvedValue({ ok: true, recordedRevision: 1, policy: { ...policy, revision: 3 } }); expect((await POST(request())).status).toBe(200);
  });
  it.each([null, "null", "https://foreign.example"])("写入拒绝来源 %s", async (requestOrigin) => { expect((await POST(request(input, requestOrigin))).status).toBe(403); expect(mocks.write).not.toHaveBeenCalled(); });
  it.each([{ ...input, confirmed: false }, { ...input, workspaceId: id }, { ...input, limits: { ...input.limits, maxModelCalls: 0 } }])("严格拒绝未确认及伪造归属", async (body) => { expect((await POST(request(body))).status).toBe(400); expect(mocks.write).not.toHaveBeenCalled(); });
  it("格式、坏编码和体积在写入前拒绝", async () => {
    expect((await POST(request(input, origin, "text/plain"))).status).toBe(415);
    expect((await POST(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{" }))).status).toBe(400);
    expect((await POST(request({ ...input, reason: "x".repeat(MAX_EXECUTION_POLICY_REQUEST_BYTES) }))).status).toBe(413);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("版本冲突不是暂时故障，数据库失败及错误回执安全拒绝", async () => {
    mocks.write.mockResolvedValue({ ok: false, conflict: true, error: "请刷新" }); expect((await POST(request())).status).toBe(409);
    mocks.write.mockResolvedValue({ ok: false, retryable: true, error: "请沿用原请求" }); expect((await POST(request())).headers.get("retry-after")).toBe("2");
    mocks.write.mockResolvedValue({ ok: true, recordedRevision: 2, policy: { ...policy, revision: 2 } }); expect((await POST(request())).status).toBe(503);
    mocks.read.mockRejectedValue(new Error("postgres://operator:private-password@db.example")); const response = await GET(new Request(url)); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-password");
  });
});
