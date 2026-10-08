import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RUN_TASK_CONTROL_BYTES, RunTaskCancelBody, RunTaskCancelInput, RunTaskCancelResult } from "@/contracts/run-task";

const cancel = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/cancel-run", () => ({ cancelRunAction: cancel }));
import { POST } from "./route";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORIGIN = "http://localhost";
const URL = `${ORIGIN}/api/runs/${ID}/cancel`;
const input = { confirmed: true, scope: "execution-chain" };
const context = (runId = ID) => ({ params: Promise.resolve({ runId }) });
function request(body: unknown = input, origin: string | null = ORIGIN, type = "application/json") {
  return new Request(URL, { method: "POST", headers: { "content-type": type, ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
}
beforeEach(() => {
  cancel.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("程序化取消任务与明确执行链范围", () => {
  it("仅通过既有 Server Action 取消，返回契约化任务入口而非执行结果", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(RunTaskCancelResult.parse(await response.json())).toMatchObject({ ok: true, runId: ID, scope: "execution-chain", links: { status: `/api/runs/${ID}`, result: `/api/runs/${ID}/result` } });
    expect(cancel).toHaveBeenCalledExactlyOnceWith(ID);
  });
  it("路径 UUID 大小写归一化后交给取消动作", async () => {
    expect((await POST(request(), context(ID.toUpperCase()))).status).toBe(200);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(ID);
  });
  it.each([{}, { confirmed: false, scope: "execution-chain" }, { confirmed: true }, { confirmed: true, scope: "single-run" }, { ...input, runId: OTHER }, { ...input, workspaceId: OTHER }])("不明确确认执行链或带额外字段时不取消 %j", async (body) => {
    expect(RunTaskCancelBody.safeParse(body).success).toBe(false);
    expect((await POST(request(body), context())).status).toBe(400);
    expect(cancel).not.toHaveBeenCalled();
  });
  it("完整控制输入继承规范化任务标识和明确范围", () => {
    expect(RunTaskCancelInput.parse({ ...input, runId: ID.toUpperCase() })).toEqual({ ...input, runId: ID });
  });
  it.each([null, "null", "https://other.example"])("取消来源 %s 不同源时拒绝", async (origin) => {
    expect((await POST(request(input, origin), context())).status).toBe(403);
    expect(cancel).not.toHaveBeenCalled();
  });
  it("跨站来源标记和非法路径不能进入动作", async () => {
    const crossSite = request();
    crossSite.headers.set("sec-fetch-site", "cross-site");
    expect((await POST(crossSite, context())).status).toBe(403);
    expect((await POST(request(), context("bad"))).status).toBe(400);
    expect(cancel).not.toHaveBeenCalled();
  });
  it("错误内容格式、JSON 和编码不取消", async () => {
    expect((await POST(request(input, ORIGIN, "text/plain"), context())).status).toBe(415);
    for (const body of ["not-json", new Uint8Array([255])]) {
      expect((await POST(new Request(URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body }), context())).status).toBe(400);
    }
    expect(cancel).not.toHaveBeenCalled();
  });
  it.each([true, false])("超限正文拒绝，声明长度 %s", async (declared) => {
    const response = await POST(new Request(URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...(declared ? { "content-length": String(MAX_RUN_TASK_CONTROL_BYTES + 1) } : {}) }, body: declared ? "{}" : "x".repeat(MAX_RUN_TASK_CONTROL_BYTES + 1) }), context());
    expect(response.status).toBe(413);
    expect(cancel).not.toHaveBeenCalled();
  });
  it("已取消任务安全重试仍返回同一任务", async () => {
    const first = await POST(request(), context());
    const second = await POST(request(), context());
    expect(await first.json()).toEqual(await second.json());
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it("已完成任务业务拒绝映射为冲突，而非临时错误", async () => {
    cancel.mockResolvedValue({ ok: false, error: "这次运行已经结束，无法取消" });
    const response = await POST(request(), context());
    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBeNull();
  });
  it("临时失败与启动尚未确认映射为可重试 503", async () => {
    cancel.mockResolvedValue({ ok: false, error: "运行尚未完成启动，请稍后再试", retryable: true });
    const response = await POST(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expect((await response.json()).retryable).toBe(true);
  });
  it("未知异常不泄露秘密，也不误报取消成功", async () => {
    cancel.mockRejectedValue(new Error("postgres://private sk-private-key-123456"));
    const response = await POST(request(), context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/postgres|sk-private/);
  });
  it("成功回执中的链接必须属于原任务", () => {
    expect(RunTaskCancelResult.safeParse({ ok: true, runId: ID, scope: "execution-chain", links: { status: `/api/runs/${OTHER}`, result: `/api/runs/${ID}/result`, report: `/api/runs/${ID}/export`, events: `/api/runs/${ID}/events`, view: `/runs/${ID}` } }).success).toBe(false);
  });
});
