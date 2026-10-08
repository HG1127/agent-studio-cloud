import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { runs, toolOperations } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getToolOperation } from "@/server/queries/tool-operations";
import { invokeToolOperation } from "@/server/services/tool-operation";
import { resolveToolOperationAction } from "@/server/actions/resolve-tool-operation";
import { GET, POST } from "@/app/api/tool-operations/[operationId]/route";
import { parseToolRegistry } from "@/server/tools/tool-registry";

const inputSchema = { type: "object" };
const outputSchema = { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } };
const tool = parseToolRegistry(JSON.stringify([{
  id: "orders.write", name: "登记订单", endpoint: "http://127.0.0.1:9000/invoke", action: "record", scope: "orders.write",
  risk: "low", businessIdempotency: true, businessIdempotencyRetentionMs: 600_000, inputSchema, outputSchema,
}]))[0];
const node = WorkflowNode.parse({
  id: "record", title: "登记订单", type: "tool",
  tool: { connector: "订单", registryToolId: tool.id, protocol: "http-json", action: tool.action, scope: tool.scope, risk: tool.risk, inputSchema, outputSchema },
  toolOperation: { scope: "order-create", key: { kind: "input", path: ["orderId"] } },
});
let runIds: string[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool]));
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ receiptId: "r1", amount: 0, approved: false }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (runIds.length) {
    await db.delete(toolOperations).where(inArray(toolOperations.sourceRunId, runIds));
    await db.delete(runs).where(inArray(runs.id, runIds));
  }
  runIds = [];
});
async function createRun(workspaceId = DEMO_WORKSPACE_ID) {
  const [row] = await db.insert(runs).values({
    workspaceId, createdBy: DEMO_USER_ID, agentId: randomUUID(), versionId: randomUUID(), status: "running", input: {},
  }).returning({ id: runs.id });
  runIds.push(row.id);
  return row.id;
}
function invoke(runId: string, amount = 10, selectedNode = node, selectedTool = tool) {
  return invokeToolOperation({
    runId, node: selectedNode, tool: selectedTool, input: { orderId: "o1" }, outputs: {},
    payload: { action: "record", input: { orderId: "o1", amount }, outputs: {} },
  });
}
describe("持久业务操作防重", () => {
  it("工具账号或请求头改变时不复用旧回执，也不重复调用", async () => {
    expect(await invoke(await createRun())).toMatchObject({ ok: true });
    expect(await invoke(await createRun(), 10, node, { ...tool, headers: { Authorization: "Bearer sk-other-account-123456" } }))
      .toMatchObject({ ok: false, error: expect.stringContaining("请求内容已变化") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("领取后超过安全窗口时禁止首次外部写入", async () => {
    const runId = await createRun();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 900_000);
    expect(await invoke(runId)).toMatchObject({ ok: false, retryable: false, error: expect.stringContaining("有效期已过") });
    expect(fetchMock).not.toHaveBeenCalled();
    const [row] = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runId));
    expect(row).toMatchObject({ status: "blocked", leaseOwner: null, leaseExpiresAt: null });
  });
  it("HTTP 人工核对可写入真实记录，同一请求重复提交不增历史或调用工具", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"receiptId":123}', { status: 200 }));
    const runId = await createRun();
    expect(await invoke(runId)).toMatchObject({ ok: false });
    const [row] = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runId));
    const context = { params: Promise.resolve({ operationId: row.id }) };
    const url = `http://localhost/api/tool-operations/${row.id}`;
    const input = { operationId: row.id, requestId: randomUUID(), kind: "record-receipt", confirmedCompleted: true, reason: "已在订单系统核对完成结果", receipt: { receiptId: "actual-order", amount: 0, approved: false } };
    const submit = () => POST(new Request(url, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(input) }), context);
    expect((await submit()).status).toBe(200);
    expect((await submit()).status).toBe(200);
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect((await response.json()).operation).toMatchObject({ status: "completed", receipt: input.receipt, resolutions: [expect.objectContaining({ requestId: input.requestId })] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("不同运行的同一业务请求复用回执，只发一次外部请求并可按作用域查询", async () => {
    const first = await invoke(await createRun());
    const second = await invoke(await createRun());
    expect(first).toMatchObject({ ok: true, reused: false });
    expect(second).toMatchObject({ ok: true, reused: true });
    if (!first.ok || !second.ok) throw new Error("应成功");
    expect(second.operationId).toBe(first.operationId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getToolOperation(DEMO_WORKSPACE_ID, first.operationId)).toMatchObject({ status: "completed", receipt: { amount: 0, approved: false } });
    expect(await getToolOperation(randomUUID(), first.operationId)).toBeNull();
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("idempotency-key")).toMatch(/^studio-operation:v1:[a-f0-9]{64}$/);
    expect(headers.get("idempotency-key")).not.toContain("o1");
  });
  it("相同标识但金额改变明确冲突，不修改原成功回执", async () => {
    const first = await invoke(await createRun());
    expect(await invoke(await createRun(), 20)).toMatchObject({ ok: false, retryable: false, error: expect.stringContaining("请求内容已变化") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (!first.ok) throw new Error("应成功");
    const [row] = await db.select().from(toolOperations).where(eq(toolOperations.id, first.operationId));
    expect(row.status).toBe("completed");
  });
  it("不同工作区相同业务标识不互相复用", async () => {
    expect(await invoke(await createRun())).toMatchObject({ ok: true, reused: false });
    expect(await invoke(await createRun(randomUUID()))).toMatchObject({ ok: true, reused: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("idempotency-key")).not.toBe(new Headers(fetchMock.mock.calls[1][1]?.headers).get("idempotency-key"));
  });
  it("并发领取只有一方调用外部系统，另一方等待后复用成功回执", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementationOnce(async () => { await gate; return new Response('{"receiptId":"r1"}', { status: 200 }); });
    const firstRun = await createRun(), secondRun = await createRun();
    const pending = invoke(firstRun);
    let second;
    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 30_000 });
      second = await invoke(secondRun);
    } finally { release(); }
    expect(second).toMatchObject({ ok: false, retryable: true, retryAfterMs: 60_000 });
    expect(await pending).toMatchObject({ ok: true });
    expect(await invoke(secondRun)).toMatchObject({ ok: true, reused: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("回执丢失后的过期租约接管复用相同外部键，由工具防止二次业务副作用", async () => {
    const receipts = new Map<string, string>();
    let effects = 0;
    fetchMock.mockImplementation(async (_url: string, options: RequestInit) => {
      const key = new Headers(options.headers).get("idempotency-key")!;
      if (!receipts.has(key)) { effects += 1; receipts.set(key, JSON.stringify({ receiptId: "effect-" + effects })); }
      return new Response(receipts.get(key), { status: 200 });
    });
    const first = await invoke(await createRun());
    if (!first.ok) throw new Error("应成功");
    await db.update(toolOperations).set({ status: "pending", receipt: null, leaseOwner: randomUUID(), leaseExpiresAt: new Date(0) }).where(eq(toolOperations.id, first.operationId));
    expect(await invoke(await createRun())).toMatchObject({ ok: true, reused: false, output: { receiptId: "effect-1" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(effects).toBe(1);
  });
  it("无效业务回执永久阻断，重跑不发第二次写入且不保存秘密正文", async () => {
    fetchMock.mockResolvedValue(new Response('{"receiptId":123,"apiKey":"sk-private-invalid-response"}', { status: 200 }));
    const runId = await createRun();
    expect(await invoke(runId)).toMatchObject({ ok: false, retryable: false });
    expect(await invoke(await createRun())).toMatchObject({ ok: false, error: expect.stringContaining("人工核对") });
    const [row] = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runId));
    expect(row).toMatchObject({ status: "blocked", receipt: null });
    expect(JSON.stringify(row)).not.toContain("sk-private");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("瞬时失败可以重试且所有尝试复用同一外部防重键", async () => {
    fetchMock.mockResolvedValueOnce(new Response("temporary", { status: 503 }));
    expect(await invoke(await createRun())).toMatchObject({ ok: false, retryable: true });
    expect(await invoke(await createRun())).toMatchObject({ ok: true });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("idempotency-key")).toBe(new Headers(fetchMock.mock.calls[1][1]?.headers).get("idempotency-key"));
  });
  it("未确认能力、标识缺失和已结束运行均在发请求前拦截", async () => {
    const runId = await createRun();
    expect(await invoke(runId, 10, node, { ...tool, businessIdempotency: false })).toMatchObject({ ok: false });
    const missing = WorkflowNode.parse({ ...node, toolOperation: { scope: "order-create", key: { kind: "input", path: ["missing"] } } });
    expect(await invoke(runId, 10, missing)).toMatchObject({ ok: false });
    await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, runId));
    expect(await invoke(runId)).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runId))).toHaveLength(0);
  });
  it("防重有效期过后停止重放，人工核对不能延长截止时间但可记录实际完成回执", async () => {
    fetchMock.mockResolvedValueOnce(new Response("temporary", { status: 503 }));
    const runId = await createRun();
    await invoke(runId);
    const [row] = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runId));
    await db.update(toolOperations).set({ retryDeadline: new Date(0) }).where(eq(toolOperations.id, row.id));
    expect(await invoke(await createRun())).toMatchObject({ ok: false, retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await resolveToolOperationAction({ operationId: row.id, requestId: randomUUID(), kind: "retry", confirmedNotExecuted: true, reason: "已核对该业务操作" }))
      .toMatchObject({ ok: false, error: expect.stringContaining("有效期已过") });
    const request = { operationId: row.id, requestId: randomUUID(), kind: "record-receipt" as const, confirmedCompleted: true as const,
      reason: "业务系统确认已完成该操作", receipt: { receiptId: "manual-r1", apiKey: "sk-private-manual-receipt" } };
    expect(await resolveToolOperationAction(request)).toEqual({ ok: true });
    expect(await resolveToolOperationAction(request)).toEqual({ ok: true });
    expect(await resolveToolOperationAction({ ...request, receipt: { receiptId: "changed" } })).toMatchObject({ ok: false });
    expect(await invoke(await createRun())).toMatchObject({ ok: true, reused: true, confirmedByHuman: true, output: { receiptId: "manual-r1" } });
    const [completed] = await db.select().from(toolOperations).where(eq(toolOperations.id, row.id));
    expect(completed.resolutions).toHaveLength(1);
    expect(completed.retryDeadline.getTime()).toBe(0);
    expect(JSON.stringify(completed)).not.toContain("sk-private");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("明确核对未执行后才重新开放同键重试，保留原因且不重写完成操作", async () => {
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    const runId = await createRun();
    await invoke(runId);
    const [row] = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runId));
    const request = { operationId: row.id, requestId: randomUUID(), kind: "retry" as const, confirmedNotExecuted: true as const, reason: "已查业务系统确定未执行" };
    expect(await resolveToolOperationAction(request)).toEqual({ ok: true });
    expect(await resolveToolOperationAction(request)).toEqual({ ok: true });
    expect(await invoke(await createRun())).toMatchObject({ ok: true, reused: false });
    expect(await resolveToolOperationAction({ ...request, requestId: randomUUID() })).toMatchObject({ ok: false, error: expect.stringContaining("不能改写") });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("idempotency-key")).toBe(new Headers(fetchMock.mock.calls[1][1]?.headers).get("idempotency-key"));
  });
  it("人工核对拒绝跨工作区访问、执行中操作和无效手工回执", async () => {
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    const runId = await createRun(randomUUID());
    await invoke(runId);
    const [foreign] = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runId));
    const request = { operationId: foreign.id, requestId: randomUUID(), kind: "record-receipt" as const, confirmedCompleted: true as const,
      reason: "业务系统核对完成", receipt: { receiptId: "r1" } };
    expect(await resolveToolOperationAction(request)).toMatchObject({ ok: false, error: expect.stringContaining("不可访问") });
    const local = await invoke(await createRun());
    if (!local.ok) throw new Error("应成功");
    await db.update(toolOperations).set({ status: "pending", leaseOwner: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) }).where(eq(toolOperations.id, local.operationId));
    expect(await resolveToolOperationAction({ ...request, operationId: local.operationId })).toMatchObject({ ok: false, error: expect.stringContaining("仍在执行") });
    await db.update(toolOperations).set({ leaseExpiresAt: new Date(0) }).where(eq(toolOperations.id, local.operationId));
    expect(await resolveToolOperationAction({ ...request, operationId: local.operationId, receipt: {} })).toMatchObject({ ok: false });
  });
});
