import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolOperationListInput, ToolOperationResolveInput, ToolOperationView } from "@/contracts/tool-operation";
import { readToolOperation, readToolOperations, submitToolOperationResolution } from "@/features/tool-operations/tool-operation-client";
import { createToolOperationResolution } from "@/features/tool-operations/tool-operation-presentation";

const id = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const operation = ToolOperationView.parse({ id, sourceRunId: runId, nodeTitle: "登记工单", toolId: "private-tool", status: "blocked", error: "业务结果未知", receipt: null, resolutions: [], retryDeadline: "2099-01-01T00:00:00.000Z", createdAt: "2026-10-09T00:00:00.123Z", updatedAt: "2026-10-09T00:00:00.123Z" });
const { receipt: omittedReceipt, resolutions: omittedHistory, ...baseSummary } = operation;
void omittedReceipt; void omittedHistory;
const summary = { ...baseSummary, resolutionCount: 0 };
const input = ToolOperationResolveInput.parse({ operationId: id, requestId, kind: "record-receipt", reason: "已核对真实业务记录", confirmedCompleted: true, receipt: { 数量: 0, 成功: false, 备注: "", 其他: null } });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("业务核对真实接口适配", () => {
  it("使用真实状态、任务和配对游标，完整保留数据库微秒且禁用缓存", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ ok: true, items: [summary], nextCursor: { id, createdAt: "2026-10-09T00:00:00.123456Z" } }));
    vi.stubGlobal("fetch", fetcher);
    const filters = ToolOperationListInput.parse({ status: "blocked", sourceRunId: runId, limit: 1, before: "2026-10-09T01:00:00.654321Z", beforeId: requestId });
    const result = await readToolOperations(filters);
    expect(result).toMatchObject({ ok: true, nextCursor: { createdAt: "2026-10-09T00:00:00.123456Z" } });
    const url = new URL(fetcher.mock.calls[0][0], "https://example.test");
    expect(url.pathname).toBe("/api/tool-operations"); expect(Object.fromEntries(url.searchParams)).toEqual({ ...filters, limit: "1" });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  });
  it("缺半个游标拒绝请求，不能静默退回第一页", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(readToolOperations({ limit: 20, before: operation.createdAt })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { ok: true, items: [{ ...summary, status: "unknown" }], nextCursor: null },
    { ok: true, items: [{ ...summary, status: "completed" }], nextCursor: null },
    { ok: true, items: [{ ...summary, sourceRunId: requestId }], nextCursor: null },
    { ok: true, items: [summary, summary], nextCursor: null },
    { ok: true, items: [summary], nextCursor: { id: requestId, createdAt: operation.createdAt } },
  ])("不接受未知状态、筛选错配、重复行或错配游标 %#", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
    await expect(readToolOperations({ limit: 20, status: "blocked", sourceRunId: runId })).rejects.toThrow();
  });
  it("详情必须与所选记录一致，不把其他业务记录当成当前记录", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: true, operation: { ...operation, id: requestId } })));
    await expect(readToolOperation(id)).rejects.toThrow("详情响应无法确认");
  });
  it("不存在的详情保留真实失败结果", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: false, error: "业务操作不存在或不可访问" }, 404)));
    expect(await readToolOperation(id)).toEqual({ ok: false, error: "业务操作不存在或不可访问" });
  });
  it("POST只发送唯一契约，保留同一请求和实际回执的零、假、空值", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ ok: true })); vi.stubGlobal("fetch", fetcher);
    expect(await submitToolOperationResolution(input)).toEqual({ ok: true });
    expect(fetcher.mock.calls[0][0]).toBe(`/api/tool-operations/${id}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" } });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input);
  });
  it.each([503, 500])("服务端 %i 即使返回成功形状也保留不确定语义", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(response({ ok: true }, status)); vi.stubGlobal("fetch", fetcher);
    expect(await submitToolOperationResolution(input)).toMatchObject({ ok: false, retryable: true }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("网络中断和无法解析的响应不自动重发", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("断线")).mockResolvedValueOnce(new Response("无法解析")); vi.stubGlobal("fetch", fetcher);
    expect(await submitToolOperationResolution(input)).toMatchObject({ ok: false, retryable: true });
    expect(await submitToolOperationResolution(input)).toMatchObject({ ok: false, retryable: true }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("确定拒绝保留服务端结果，不伪称保存或恢复成功", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: false, error: "业务工具未确认支持防重，不能重新发送" }, 409)));
    expect(await submitToolOperationResolution(input)).toEqual({ ok: false, error: "业务工具未确认支持防重，不能重新发送" });
  });
});

describe("核对草稿校验", () => {
  it("保留实际回执所有空值，原因按唯一契约去空格", () => {
    expect(createToolOperationResolution(operation, "record-receipt", "  已核对业务系统记录  ", '{"数量":0,"成功":false,"备注":"","其他":null}', true, requestId)).toMatchObject({ requestId, reason: "已核对业务系统记录", receipt: { 数量: 0, 成功: false, 备注: "", 其他: null } });
  });
  it.each(["[]", "false", "null", "坏格式", '{"__proto__":{}}', JSON.stringify({ 内容: "中".repeat(400_000) })])("实际回执对象形状与容量必须有效 %#", (receipt) => {
    expect(() => createToolOperationResolution(operation, "record-receipt", "已核对业务系统记录", receipt, true, requestId)).toThrow();
  });
  it("必须明确确认，原因不能只有空白，已完成不能重复核对", () => {
    expect(() => createToolOperationResolution(operation, "retry", "已核对业务系统记录", "", false, requestId)).toThrow("明确确认");
    expect(() => createToolOperationResolution(operation, "retry", "     ", "", true, requestId)).toThrow("五到五百");
    expect(() => createToolOperationResolution({ ...operation, status: "completed" }, "retry", "已核对业务系统记录", "", true, requestId)).toThrow("不能再填写");
  });
  it("重新尝试只带明确未执行确认，期限过后禁用此路径", () => {
    expect(createToolOperationResolution(operation, "retry", "已核对业务系统记录", "", true, requestId)).toEqual({ operationId: id, requestId, kind: "retry", reason: "已核对业务系统记录", confirmedNotExecuted: true });
    expect(() => createToolOperationResolution({ ...operation, retryDeadline: "2000-01-01T00:00:00.000Z" }, "retry", "已核对业务系统记录", "", true, requestId)).toThrow("期限已过");
  });
});
