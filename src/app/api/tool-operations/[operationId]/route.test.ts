import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TOOL_OPERATION_RESOLVE_BYTES, ToolOperationGetResult } from "@/contracts/tool-operation";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";

const mocks = vi.hoisted(() => ({ get: vi.fn(), resolve: vi.fn() }));
vi.mock("@/server/queries/tool-operations", () => ({ getToolOperation: mocks.get }));
vi.mock("@/server/actions/resolve-tool-operation", () => ({ resolveToolOperationAction: mocks.resolve }));
import { GET, POST } from "./route";

const OPERATION_ID = "00000000-0000-4000-8000-000000000121";
const REQUEST_ID = "00000000-0000-4000-8000-000000000122";
const ORIGIN = "http://localhost";
const URL = `${ORIGIN}/api/tool-operations/${OPERATION_ID}`;
const input = { operationId: OPERATION_ID, requestId: REQUEST_ID, reason: "已核对业务系统未执行", kind: "retry", confirmedNotExecuted: true };
const view = {
  id: OPERATION_ID, sourceRunId: REQUEST_ID, nodeTitle: "登记订单", toolId: "orders.write", status: "blocked",
  error: "需要核对", receipt: null, retryDeadline: "2026-10-08T12:00:00.000Z", resolutions: [],
  createdAt: "2026-10-08T11:00:00.000Z", updatedAt: "2026-10-08T11:01:00.000Z",
};
const context = (operationId = OPERATION_ID) => ({ params: Promise.resolve({ operationId }) });
function request(body: unknown = input, origin: string | null = ORIGIN) {
  return new Request(URL, {
    method: "POST", headers: { "content-type": "application/json", ...(origin === null ? {} : { origin }) },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(view);
  mocks.resolve.mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("业务操作核对 HTTP 入口", () => {
  it("读取当前工作区记录并按共享契约返回，禁止缓存", async () => {
    const response = await GET(new Request(URL), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(ToolOperationGetResult.parse(await response.json())).toEqual({ ok: true, operation: view });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, OPERATION_ID);
  });
  it("缺失记录不返回其他工作区信息", async () => {
    mocks.get.mockResolvedValue(null);
    const response = await GET(new Request(URL), context());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "业务操作不存在或不可访问" });
  });
  it("非法标识不查库", async () => {
    expect((await GET(new Request(URL), context("bad"))).status).toBe(400);
    expect((await POST(request(), context("bad"))).status).toBe(400);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("跨站读取不查库", async () => {
    expect((await GET(new Request(URL, { headers: { origin: "https://other.example" } }), context())).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("查询异常不暴露数据库或密钥信息", async () => {
    mocks.get.mockRejectedValue(new Error("postgres://private sk-private-key-123456"));
    const response = await GET(new Request(URL), context());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/postgres|sk-private/);
  });
  it("拒绝服务端返回不符合共享契约的记录", async () => {
    mocks.get.mockResolvedValue({ ...view, status: "invented" });
    expect((await GET(new Request(URL), context())).status).toBe(500);
  });
  it("人工确认未执行后只通过服务端写入口提交", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(input);
  });
  it("人工记录实际回执保留零金额和否定值", async () => {
    const receiptInput = { operationId: OPERATION_ID, requestId: REQUEST_ID, reason: "已在业务系统找到实际回执", kind: "record-receipt", confirmedCompleted: true, receipt: { amount: 0, approved: false } };
    expect((await POST(request(receiptInput), context())).status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(receiptInput);
  });
  it.each(["https://other.example", null])("提交来源 %s 不同源时拒绝写入", async (origin) => {
    expect((await POST(request(input, origin), context())).status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("地址与正文操作标识不一致时拒绝写入", async () => {
    expect((await POST(request({ ...input, operationId: REQUEST_ID }), context())).status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("缺少实际状态确认时拒绝写入", async () => {
    const incomplete = { ...input, confirmedNotExecuted: undefined };
    expect((await POST(request(incomplete), context())).status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("禁止回执包含保留字段", async () => {
    expect((await POST(request({ operationId: OPERATION_ID, requestId: REQUEST_ID, reason: "已核对业务系统完成结果", kind: "record-receipt", confirmedCompleted: true, receipt: JSON.parse('{"constructor":"unsafe"}') }), context())).status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each(["not-json", new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125])])("非法 JSON 或编码不写入", async (body) => {
    const response = await POST(new Request(URL, { method: "POST", headers: { origin: ORIGIN }, body }), context());
    expect(response.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("声明超限时在读取前拒绝", async () => {
    const response = await POST(new Request(URL, { method: "POST", headers: { origin: ORIGIN, "content-length": String(MAX_TOOL_OPERATION_RESOLVE_BYTES + 1) }, body: "{}" }), context());
    expect(response.status).toBe(413);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("未声明长度的实际超限正文也拒绝", async () => {
    const response = await POST(new Request(URL, { method: "POST", headers: { origin: ORIGIN }, body: "a".repeat(MAX_TOOL_OPERATION_RESOLVE_BYTES + 1) }), context());
    expect(response.status).toBe(413);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("业务状态不允许核对时返回冲突而非成功", async () => {
    mocks.resolve.mockResolvedValue({ ok: false, error: "业务操作仍在执行，请等候结果后核对" });
    const response = await POST(request(), context());
    expect(response.status).toBe(409);
    expect((await response.json()).ok).toBe(false);
  });
  it("暂时存储失败提示使用同一次请求重试", async () => {
    mocks.resolve.mockResolvedValue({ ok: false, error: "核对记录暂时无法保存，请使用同一次请求重试", retryable: true });
    const response = await POST(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expect((await response.json()).retryable).toBe(true);
  });
  it("写入异常不能误报成功或暴露秘密", async () => {
    mocks.resolve.mockRejectedValue(new Error("sk-private-key-123456"));
    const response = await POST(request(), context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sk-private");
  });
});
