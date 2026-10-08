import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RUN_APPROVAL_DECISION_BYTES, RunApprovalDecisionResult, RunApprovalGetResult } from "@/contracts/run-approval";
const mocks = vi.hoisted(() => ({ decide: vi.fn(), get: vi.fn() }));
vi.mock("@/server/actions/decide-run-approval", () => ({ decideRunApprovalAction: mocks.decide }));
vi.mock("@/server/queries/run-approvals", () => ({ getRunApproval: mocks.get }));
import { GET, POST } from "./route";
const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORIGIN = "http://localhost";
const URL = `${ORIGIN}/api/runs/${RUN}/approvals/${ID}`;
const body = { confirmed: true, decision: "approved", note: "已核对" };
const receipt = { ok: true, runId: RUN, approvalId: ID, decision: "approved", recorded: true };
const detail = { id: ID, runId: RUN, nodeId: "confirm", nodeTitle: "核对金额", status: "pending", role: "负责人", reason: "核对成果", review: { sourceNodeId: "extract", sourceTitle: "提取金额", format: "json", content: '{"amount":0,"approved":false}' }, note: null, decidedAt: null, createdAt: "2000-01-01T00:00:00Z", runStatus: "waiting_approval", state: "pending", decisionConsumed: false };
const context = (runId = RUN, approvalId = ID) => ({ params: Promise.resolve({ runId, approvalId }) });
function request(value: unknown = body, origin: string | null = ORIGIN, type = "application/json") {
  return new Request(URL, { method: "POST", headers: { "content-type": type, ...(origin ? { origin } : {}) }, body: JSON.stringify(value) });
}
beforeEach(() => { mocks.decide.mockReset().mockResolvedValue(receipt); mocks.get.mockReset().mockResolvedValue({ kind: "found", approval: detail }); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());
describe("程序化审批读取与明确决定 HTTP 边界", () => {
  it("读取完整业务成果，保留零值和否定值且不含 Hook 凭据", async () => {
    const response = await GET(new Request(URL), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(RunApprovalGetResult.parse(await response.json())).toMatchObject({ ok: true, approval: { review: { content: detail.review.content }, state: "pending" } });
  });
  it.each(["missing", "unavailable"])("无法读取 %s 不返回空成果冒充有效确认", async (kind) => {
    mocks.get.mockResolvedValue({ kind });
    const response = await GET(new Request(URL), context());
    expect(response.status).toBe(kind === "missing" ? 404 : 409);
    expect((await response.json()).ok).toBe(false);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("读写都拒绝跨站标记，读取允许已保护部署中的无 Origin 服务端请求", async () => {
    const reading = new Request(URL, { headers: { "sec-fetch-site": "cross-site" } });
    const writing = request(); writing.headers.set("sec-fetch-site", "cross-site");
    expect((await GET(reading, context())).status).toBe(403);
    expect((await GET(new Request(URL, { headers: { origin: "https://other.example" } }), context())).status).toBe(403);
    expect((await POST(writing, context())).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("仅通过 Server Action 提交，规范化路径并返回决定接收而非业务完成", async () => {
    const response = await POST(request(), context(RUN.toUpperCase(), ID.toUpperCase()));
    expect(response.status).toBe(200);
    expect(RunApprovalDecisionResult.parse(await response.json())).toEqual(receipt);
    expect(mocks.decide).toHaveBeenCalledExactlyOnceWith({ ...body, runId: RUN, approvalId: ID });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each([{}, { decision: "approved" }, { ...body, confirmed: false }, { ...body, resumeOnly: true }, { ...body, runId: ID }, { ...body, approvalId: RUN }, { ...body, workspaceId: RUN }])("严格拒绝不明确或额外控制字段 %j", async (value) => {
    expect((await POST(request(value), context())).status).toBe(400);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it.each([null, "null", "https://other.example"])("无同源提交依据 %s 时拒绝", async (origin) => {
    expect((await POST(request(body, origin), context())).status).toBe(403);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("非法路径、格式、JSON 与 UTF-8 不进入动作", async () => {
    expect((await GET(new Request(URL), context("bad"))).status).toBe(400);
    expect((await POST(request(), context(RUN, "bad"))).status).toBe(400);
    expect((await POST(request(body, ORIGIN, "text/plain"), context())).status).toBe(415);
    for (const value of ["not-json", new Uint8Array([255])]) expect((await POST(new Request(URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: value }), context())).status).toBe(400);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it.each([true, false])("超限正文拒绝，声明长度 %s", async (declared) => {
    const response = await POST(new Request(URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...(declared ? { "content-length": String(MAX_RUN_APPROVAL_DECISION_BYTES + 1) } : {}) }, body: declared ? "{}" : "中".repeat(MAX_RUN_APPROVAL_DECISION_BYTES) }), context());
    expect(response.status).toBe(413); expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("冲突与已保存但恢复待确认使用不同状态和重试指示", async () => {
    mocks.decide.mockResolvedValueOnce({ ok: false, error: "备注不同" }).mockResolvedValueOnce({ ok: false, error: "恢复待确认", saved: true, retryable: true });
    expect((await POST(request(), context())).status).toBe(409);
    const response = await POST(request(), context());
    expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.json()).toMatchObject({ ok: false, saved: true, retryable: true });
  });
  it("未知异常不泄露秘密，也不虚报决定成功", async () => {
    mocks.decide.mockRejectedValue(new Error("postgres://private sk-private-key-123456"));
    const response = await POST(request(), context());
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/postgres|sk-private/);
  });
  it("回执或读取结果不属于原确认时拒绝，不交付另一任务", async () => {
    mocks.decide.mockResolvedValue({ ...receipt, approvalId: RUN });
    mocks.get.mockResolvedValue({ kind: "found", approval: { ...detail, runId: ID } });
    expect((await POST(request(), context())).status).toBe(503);
    expect((await GET(new Request(URL), context())).status).toBe(503);
  });
});
