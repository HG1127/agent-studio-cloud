import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), update: vi.fn(), invoke: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction, update: mocks.update } }));
vi.mock("@/server/tools/invoke-tool", () => ({ invokeRegisteredTool: mocks.invoke }));

import { runs, toolOperations } from "@/db/schema";
import { WorkflowNode } from "@/contracts/workflow";
import { hasDefaultHttpStepOperation, invokeToolOperation } from "./tool-operation";
import { defaultHttpStepOperationKey } from "@/server/domain/runtime/default-http-tool-operation";
import { toolStepIdempotencyKey } from "@/server/domain/runtime/tool-step-idempotency-key";
import type { ToolRegistration } from "@/server/tools/tool-registry";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const createdBy = "00000000-0000-4000-8000-000000000003";
const operationId = "00000000-0000-4000-8000-000000000004";
const now = new Date("2026-10-16T00:00:00.000Z");
const receipt = { receiptId: "r1", amount: 0, approved: false };
const outputSchema = { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } };
const node = WorkflowNode.parse({ id: "write", title: "登记订单", type: "tool", tool: {
  connector: "订单系统", registryToolId: "orders", protocol: "http-json", operationKind: "action",
  action: "create", scope: "orders.write", risk: "medium", inputSchema: { type: "object" }, outputSchema,
} });
const tool: ToolRegistration = {
  id: "orders", name: "订单系统", description: "", protocol: "http-json", operationKind: "action",
  action: "create", scope: "orders.write", risk: "medium", method: "POST", endpoint: "https://tools.example.com/orders",
  headers: {}, inputSchema: { type: "object" }, outputSchema, businessIdempotency: true, businessIdempotencyRetentionMs: 600_000,
};
const args = {
  runId, node, tool, input: { orderId: "o1" }, outputs: { plan: { amount: 0, approved: false } },
  payload: { action: "create", input: { orderId: "o1" }, outputs: { plan: { amount: 0, approved: false } } },
  defaultHttpStep: { stepId: "step-1", stepStartedAt: new Date(now.getTime() - 60_000), attempt: 1 },
};

type Row = typeof toolOperations.$inferSelect;
type Query = { from: (table: unknown) => Query; where: (condition: SQL) => Query; for: (mode: string) => Query; limit: () => Promise<unknown[]> };
let row: Row | undefined;
let run: { workspaceId: string; createdBy: string; status: string } | undefined;
let readFailure = false;
let saveUnknown = false;
let clauses: SQL[];
let writes: Partial<Row>[];

function select(): Query {
  let table: unknown;
  const query: Query = {
    from: (value) => { table = value; return query; },
    where: (value) => { clauses.push(value); return query; },
    for: () => query,
    limit: async () => {
      if (readFailure) throw new Error("private database failure");
      return table === runs ? run ? [run] : [] : row ? [row] : [];
    },
  };
  return query;
}

function insert() {
  return { values: (values: Partial<Row>) => ({ onConflictDoNothing: () => ({ returning: async () => {
    if (row) return [];
    row = { id: operationId, receipt: null, error: null, resolutions: [], createdAt: now, updatedAt: now, ...values } as Row;
    writes.push(values);
    return [row];
  } }) }) };
}

function update() {
  return { set: (values: Partial<Row>) => ({ where: (condition: SQL) => {
    clauses.push(condition);
    writes.push(values);
    const changed = row !== undefined && !(saveUnknown && values.status === "completed");
    if (changed) Object.assign(row!, values);
    return Object.assign(Promise.resolve(), { returning: async () => changed ? [row] : [] });
  } }) };
}

function currentRow(): Row {
  if (!row) throw new Error("Expected a fake persisted operation");
  return row;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.resetAllMocks();
  row = undefined; run = { workspaceId, createdBy, status: "running" };
  readFailure = false; saveUnknown = false; clauses = []; writes = [];
  mocks.transaction.mockImplementation(async (callback) => callback({ select, insert, update }));
  mocks.update.mockImplementation(update);
  mocks.invoke.mockResolvedValue({ ok: true, output: receipt });
});
afterEach(() => { vi.useRealTimers(); });

describe("HTTP 默认账本服务，持久层和传输均为内存替身", () => {
  it("无保证、错误协议或性质、混用显式键和无效步骤上下文均不发请求", async () => {
    const invalid = [
      { tool: { ...tool, businessIdempotency: false } },
      { tool: { ...tool, operationKind: "read" as const } },
      { tool: { ...tool, protocol: "mcp-streamable-http" as const } },
      { node: { ...node, toolOperation: { scope: "orders", key: { kind: "literal" as const, value: "o1" } } } },
      { defaultHttpStep: { ...args.defaultHttpStep, attempt: 0 } },
      { defaultHttpStep: { ...args.defaultHttpStep, stepId: "\n" } },
    ];
    for (const change of invalid) await expect(invokeToolOperation({ ...args, ...change })).resolves.toMatchObject({ ok: false, retryable: false });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("首次登记完整请求、首次截止与旧外部键，重复只复用实际保存回执", async () => {
    await expect(invokeToolOperation(args)).resolves.toMatchObject({ ok: true, reused: false, output: receipt });
    expect(currentRow()).toMatchObject({
      workspaceId, sourceRunId: runId, createdBy, status: "completed", receipt,
      retryDeadline: new Date(args.defaultHttpStep.stepStartedAt.getTime() + 480_000),
    });
    expect(mocks.invoke).toHaveBeenCalledWith({
      tool, idempotencyKey: runId + ":write:step-1", ...args.payload,
    });
    const before = structuredClone(currentRow());
    await expect(invokeToolOperation({ ...args, defaultHttpStep: { ...args.defaultHttpStep, attempt: 2 } }))
      .resolves.toMatchObject({ ok: true, reused: true, output: receipt });
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(currentRow()).toEqual(before);
  });

  it("中文内联默认 HTTP 操作沿当前安全头编码，持久定位仍保留完整名称", async () => {
    const inline = { ...args, node: { ...node, id: "group.登记" } };
    await invokeToolOperation(inline);
    const key = defaultHttpStepOperationKey({ workspaceId, toolId: tool.id, action: tool.action, runId, nodeId: inline.node.id, stepId: "step-1" });
    if (!key.ok) throw new Error("Expected a valid key");
    expect(currentRow().keyHash).toBe(createHash("sha256").update(key.material).digest("hex"));
    expect(mocks.invoke.mock.calls[0][0].idempotencyKey)
      .toBe(toolStepIdempotencyKey({ runId, nodeId: inline.node.id, stepId: "step-1" }));
  });

  it("缺少历史账本的旧重试只能登记待核对，不发送业务请求", async () => {
    await expect(invokeToolOperation({ ...args, defaultHttpStep: { ...args.defaultHttpStep, attempt: 2 } }))
      .resolves.toMatchObject({ ok: false, retryable: false });
    expect(currentRow()).toMatchObject({ status: "blocked", leaseOwner: null, leaseExpiresAt: null });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("503 后在同期限内重试只沿原键，首次截止不被当前时间延长", async () => {
    mocks.invoke.mockResolvedValueOnce({ ok: false, error: "unavailable", retryable: true });
    await expect(invokeToolOperation(args)).resolves.toMatchObject({ ok: false, retryable: true });
    const deadline = currentRow().retryDeadline.getTime();
    vi.setSystemTime(new Date(now.getTime() + 1000));
    await expect(invokeToolOperation({ ...args, defaultHttpStep: { ...args.defaultHttpStep, attempt: 2 } }))
      .resolves.toMatchObject({ ok: true, reused: false });
    expect(currentRow().retryDeadline.getTime()).toBe(deadline);
    expect(mocks.invoke.mock.calls.map(([input]) => input.idempotencyKey)).toEqual(Array(2).fill(runId + ":write:step-1"));
  });

  it("未知结果过期后阻断，而已完成回执过期后仍只读复用", async () => {
    mocks.invoke.mockResolvedValueOnce({ ok: false, error: "unavailable", retryable: true });
    await invokeToolOperation(args);
    vi.setSystemTime(new Date(currentRow().retryDeadline.getTime() + 1));
    await expect(invokeToolOperation({ ...args, defaultHttpStep: { ...args.defaultHttpStep, attempt: 2 } }))
      .resolves.toMatchObject({ ok: false, retryable: false });
    expect(currentRow().status).toBe("blocked");
    expect(mocks.invoke).toHaveBeenCalledOnce();
    row!.status = "completed"; row!.receipt = receipt;
    await expect(invokeToolOperation({ ...args, defaultHttpStep: { ...args.defaultHttpStep, attempt: 3 } }))
      .resolves.toMatchObject({ ok: true, reused: true, output: receipt });
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it.each([
    { endpoint: "https://tools.example.com/other" },
    { headers: { authorization: "Bearer changed-private-account" } },
    { businessIdempotencyRetentionMs: 700_000 },
  ])("地址、账号或保证改变时不复用旧请求，也不重新调用 %#", async (change) => {
    await invokeToolOperation(args);
    const before = structuredClone(currentRow());
    await expect(invokeToolOperation({ ...args, tool: { ...tool, ...change } })).resolves.toMatchObject({ ok: false, retryable: false });
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(currentRow()).toEqual(before);
  });

  it("完整信封的上游结果变化形成冲突，不将 HTTP outputs 清空", async () => {
    await invokeToolOperation(args);
    await expect(invokeToolOperation({ ...args, payload: { ...args.payload, outputs: { plan: { amount: 1, approved: false } } } }))
      .resolves.toMatchObject({ ok: false, error: expect.stringContaining("请求内容已变化") });
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke.mock.calls[0][0].outputs).toEqual(args.payload.outputs);
  });

  it("坏回执阻断后再次运行不发请求，缓存也按当前和冻结契约检查", async () => {
    mocks.invoke.mockResolvedValueOnce({ ok: true, output: { receiptId: 123 } });
    await expect(invokeToolOperation(args)).resolves.toMatchObject({ ok: false, retryable: false });
    expect(currentRow().status).toBe("blocked");
    await expect(invokeToolOperation(args)).resolves.toMatchObject({ ok: false });
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("保存回执未确认时保留租约，不当作可重复发送", async () => {
    saveUnknown = true;
    await expect(invokeToolOperation(args)).resolves.toMatchObject({ ok: false, retryable: true });
    expect(currentRow()).toMatchObject({ status: "pending", receipt: null });
    await expect(invokeToolOperation({ ...args, defaultHttpStep: { ...args.defaultHttpStep, attempt: 2 } }))
      .resolves.toMatchObject({ ok: false, retryable: true });
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("首次时间已过期或伪造到未来时绝不发请求", async () => {
    for (const startedAt of [new Date(now.getTime() - 600_000), new Date(now.getTime() + 1), new Date(NaN)]) {
      row = undefined;
      await expect(invokeToolOperation({ ...args, defaultHttpStep: { ...args.defaultHttpStep, stepStartedAt: startedAt } }))
        .resolves.toMatchObject({ ok: false, retryable: false });
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("既有记录的期限比重试元信息更早时不能被延长", async () => {
    mocks.invoke.mockResolvedValueOnce({ ok: false, error: "unavailable", retryable: true });
    await invokeToolOperation(args);
    row!.retryDeadline = new Date(now.getTime() - 1);
    const deadline = currentRow().retryDeadline;
    await expect(invokeToolOperation({ ...args, defaultHttpStep: { ...args.defaultHttpStep, stepStartedAt: now, attempt: 2 } }))
      .resolves.toMatchObject({ ok: false, retryable: false });
    expect(currentRow().retryDeadline).toEqual(deadline);
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("合法请求刚好 512KB 保留原字段，超一字节在账本和传输前拒绝", async () => {
    const payload = { action: "create", input: { text: "" }, outputs: {} };
    payload.input.text = "x".repeat(512 * 1024 - new TextEncoder().encode(JSON.stringify(payload)).byteLength);
    await expect(invokeToolOperation({ ...args, payload })).resolves.toMatchObject({ ok: true });
    expect(mocks.invoke.mock.calls[0][0].input.text).toBe(payload.input.text);
    mocks.transaction.mockClear(); mocks.invoke.mockClear();
    await expect(invokeToolOperation({ ...args, payload: { ...payload, input: { text: payload.input.text + "x" } } }))
      .resolves.toMatchObject({ ok: false });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("访问器输入不执行 getter，也不进入账本或网络", async () => {
    const getter = vi.fn(() => "private");
    const input = Object.defineProperty({}, "value", { enumerable: true, get: getter });
    await expect(invokeToolOperation({ ...args, payload: { ...args.payload, input } })).resolves.toMatchObject({ ok: false });
    expect(getter).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("HTTP 默认保护记录探测，内存替身不证明数据库隔离", () => {
  const probe = { runId, nodeId: node.id, toolId: tool.id, action: tool.action, stepId: "step-1" };
  it("只读事务只按实际工作区与固定步骤摘要定位，不返回业务请求", async () => {
    await invokeToolOperation(args);
    mocks.transaction.mockClear(); clauses = []; writes = [];
    await expect(hasDefaultHttpStepOperation(probe)).resolves.toBe(true);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ accessMode: "read only" });
    expect(writes).toEqual([]);
    const where = new PgDialect().sqlToQuery(clauses[1]);
    expect(where.params).toEqual([workspaceId, currentRow().keyHash]);
    expect(JSON.stringify(where.params)).not.toContain("orderId");
  });

  it("没有记录才返回 false；没有运行或归属未知时失败关闭", async () => {
    await expect(hasDefaultHttpStepOperation(probe)).resolves.toBe(false);
    run = undefined;
    await expect(hasDefaultHttpStepOperation(probe)).rejects.toMatchObject({ name: "FatalError" });
    readFailure = true;
    await expect(hasDefaultHttpStepOperation(probe)).rejects.toMatchObject({ name: "RetryableError" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each(["completed", "failed", "cancelled"])("运行 %s 时不把保护状态视为未发生", async (status) => {
    run!.status = status;
    await expect(hasDefaultHttpStepOperation(probe)).rejects.toMatchObject({ name: "FatalError" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("既有保护记录的运行、工具或动作不匹配时拒绝返回可直连结论", async () => {
    await invokeToolOperation(args);
    for (const change of [{ sourceRunId: operationId }, { toolId: "other" }, { action: "other" }]) {
      const before = { ...currentRow() };
      Object.assign(row!, change);
      await expect(hasDefaultHttpStepOperation(probe)).rejects.toMatchObject({ name: "FatalError" });
      row = before;
    }
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });
});
