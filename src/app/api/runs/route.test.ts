import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RUN_TASK_REQUEST_BYTES, RunTaskResult, RunTaskStartResult, RunTaskStatusResult } from "@/contracts/run-task";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { presentRunTaskResult, presentRunTaskStatus, runTaskLinks } from "@/server/domain/runtime/run-task";

const mocks = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn(), result: vi.fn() }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: mocks.start }));
vi.mock("@/server/queries/run-tasks", () => ({ getRunTaskStatus: mocks.status, getRunTaskResult: mocks.result }));
import { POST } from "./route";
import { GET as getStatus } from "./[runId]/route";
import { GET as getResult } from "./[runId]/result/route";

const ID = "00000000-0000-4000-8000-000000000171";
const REQUEST_ID = "00000000-0000-4000-8000-000000000172";
const ORIGIN = "http://localhost";
const URL = `${ORIGIN}/api/runs`;
const input = { agentId: ID, requestId: REQUEST_ID, input: { amount: 0, approved: false } };
const statusView = presentRunTaskStatus({ runId: ID, agentId: ID, agentName: "业务助手", versionId: ID, version: 1, status: "running", error: null, startedAt: null, finishedAt: null });
const resultView = presentRunTaskResult({ runId: ID, status: "completed", result: input.input, error: null, outputContract: { fields: [] } });
const context = (runId = ID) => ({ params: Promise.resolve({ runId }) });
function request(body: unknown = input, origin: string | null = ORIGIN, contentType = "application/json") {
  return new Request(URL, { method: "POST", headers: { "content-type": contentType, ...(origin === null ? {} : { origin }) }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.start.mockResolvedValue({ ok: true, runId: ID });
  mocks.status.mockResolvedValue(statusView);
  mocks.result.mockResolvedValue(resultView);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("任务提交 HTTP 接口", () => {
  it("资源名额已满返回明确 429 和原请求重试提示，不伪报启动成功", async () => {
    mocks.start.mockResolvedValue({ ok: false, error: "当前并发名额已满", retryable: true, resourceLimit: { kind: "concurrent-chains", current: 1, maximum: 1 } });
    const response = await POST(request()); expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("2");
    expect(RunTaskStartResult.parse(await response.json())).toMatchObject({ ok: false, resourceLimit: { kind: "concurrent-chains" } });
  });
  it("按共享契约返回已接收和任务入口，不把接收等同于执行成功", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBe(`/api/runs/${ID}`);
    expect(RunTaskStartResult.parse(await response.json())).toEqual({ ok: true, runId: ID, links: runTaskLinks(ID) });
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(input);
  });
  it("版本参数和带字符集的 JSON 原样进入写入口", async () => {
    const pinned = { ...input, versionId: REQUEST_ID };
    expect((await POST(request(pinned, ORIGIN, "Application/JSON; charset=utf-8"))).status).toBe(202);
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(pinned);
  });
  it.each(["https://other.example", "null", null])("拒绝非同源写入 %s", async (origin) => {
    expect((await POST(request(input, origin))).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("跨站来源标记不能被同源 Origin 绕过", async () => {
    const submitted = request();
    submitted.headers.set("sec-fetch-site", "cross-site");
    expect((await POST(submitted)).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["text/plain", "application/x-www-form-urlencoded", ""])("拒绝错误内容格式 %s", async (type) => {
    expect((await POST(request(input, ORIGIN, type))).status).toBe(415);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["not-json", new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125])])("拒绝坏 JSON 或 UTF-8", async (body) => {
    expect((await POST(new Request(URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body }))).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([false, true])("拒绝超限正文，已声明长度 %s", async (declared) => {
    const response = await POST(new Request(URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...(declared ? { "content-length": String(MAX_RUN_TASK_REQUEST_BYTES + 1) } : {}) }, body: declared ? "{}" : "中".repeat(MAX_RUN_TASK_REQUEST_BYTES) }));
    expect(response.status).toBe(413);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([{ agentId: ID }, { ...input, requestId: "bad" }, { ...input, workspaceId: REQUEST_ID }, { ...input, callbackUrl: "https://other.example" }, { ...input, input: [] }])("拒绝不符合任务契约的请求 %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("确定性业务拒绝返回冲突", async () => {
    mocks.start.mockResolvedValue({ ok: false, error: "请求标识已用于另一版本" });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).ok).toBe(false);
    expect(response.headers.get("retry-after")).toBeNull();
  });
  it("临时启动问题保留原请求重试语义", async () => {
    mocks.start.mockResolvedValue({ ok: false, error: "启动待确认", retryable: true });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expect((await response.json()).retryable).toBe(true);
  });
  it("未知异常或坏回执不伪报成功、不回显秘密", async () => {
    mocks.start.mockRejectedValueOnce(new Error("postgres://private sk-private-key-123456"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/postgres|sk-private/);
    mocks.start.mockResolvedValueOnce({ ok: true, runId: "bad" });
    expect((await POST(request())).status).toBe(503);
  });
});

describe("任务状态和最终结果 HTTP 接口", () => {
  it("状态只读取当前工作区并按共享契约返回", async () => {
    const response = await getStatus(new Request(`${URL}/${ID}`), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(RunTaskStatusResult.parse(await response.json())).toEqual({ ok: true, task: statusView });
    expect(mocks.status).toHaveBeenCalledExactlyOnceWith(ID, DEMO_WORKSPACE_ID);
  });
  it("完成结果保留业务字段与否定值", async () => {
    const response = await getResult(new Request(`${URL}/${ID}/result`), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(RunTaskResult.parse(await response.json())).toEqual({ ok: true, task: resultView });
    expect(mocks.result).toHaveBeenCalledExactlyOnceWith(ID, DEMO_WORKSPACE_ID);
  });
  it.each(["queued", "running", "waiting_approval", "waiting_event"] as const)("任务 %s 时结果未就绪，不泄漏过程成果", async (status) => {
    mocks.result.mockResolvedValue(presentRunTaskResult({ runId: ID, status, result: { partial: true }, error: null, outputContract: { fields: [] } }));
    const response = await getResult(new Request(`${URL}/${ID}/result`), context());
    expect(response.status).toBe(202);
    expect(response.headers.get("retry-after")).toBe("2");
    expect((await response.json()).task).toMatchObject({ status, ready: false, result: null });
  });
  it.each(["failed", "cancelled"] as const)("任务 %s 已终结但不是业务成功", async (status) => {
    mocks.result.mockResolvedValue(presentRunTaskResult({ runId: ID, status, result: { partial: true }, error: null, outputContract: { fields: [] } }));
    const response = await getResult(new Request(`${URL}/${ID}/result`), context());
    expect(response.status).toBe(200);
    expect((await response.json()).task).toMatchObject({ status, ready: true, result: null });
  });
  it.each([getStatus, getResult])("非法标识、跨站请求和缺失任务不会返回数据", async (read) => {
    expect((await read(new Request(`${URL}/${ID}`), context("bad"))).status).toBe(400);
    expect((await read(new Request(`${URL}/${ID}`, { headers: { origin: "https://other.example" } }), context())).status).toBe(403);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.result).not.toHaveBeenCalled();
    mocks.status.mockResolvedValue(null);
    mocks.result.mockResolvedValue(null);
    expect((await read(new Request(`${URL}/${ID}`), context())).status).toBe(404);
  });
  it.each([getStatus, getResult])("临时读取失败可重试且不回显存储秘密", async (read) => {
    mocks.status.mockRejectedValue(new Error("postgres://private"));
    mocks.result.mockRejectedValue(new Error("sk-private-key-123456"));
    const response = await read(new Request(`${URL}/${ID}`), context());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.text()).not.toMatch(/postgres|sk-private/);
  });
  it("服务端投影违反状态或结果边界时不能发出成功响应", async () => {
    mocks.status.mockResolvedValue({ ...statusView, terminal: true });
    mocks.result.mockResolvedValue({ ...resultView, status: "running" });
    expect((await getStatus(new Request(`${URL}/${ID}`), context())).status).toBe(503);
    expect((await getResult(new Request(`${URL}/${ID}/result`), context())).status).toBe(503);
  });
});
