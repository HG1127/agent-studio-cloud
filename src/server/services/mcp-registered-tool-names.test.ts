import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { parseToolRegistry } from "@/server/tools/tool-registry";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), update: vi.fn(), invoke: vi.fn(), captured: undefined as Record<string, unknown> | undefined }));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction, update: mocks.update } }));
vi.mock("@/server/tools/invoke-tool", () => ({ invokeRegisteredTool: mocks.invoke }));
import { invokeToolOperation } from "./tool-operation";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000010";
const runId = "00000000-0000-4000-8000-000000000020";
beforeEach(() => {
  vi.clearAllMocks(); mocks.captured = undefined;
  mocks.transaction.mockImplementation(async (operation: (tx: object) => Promise<unknown>) => operation({
    select: () => ({ from: () => ({ where: () => ({ for: () => ({ limit: async () => [{ workspaceId, createdBy: workspaceId, status: "running" }] }) }) }) }),
    insert: () => ({ values: (values: Record<string, unknown>) => {
      mocks.captured = values;
      return { onConflictDoNothing: () => ({ returning: async () => [{ ...values, id: operationId, resolutions: [] }] }) };
    } }),
  }));
  mocks.update.mockReturnValue({ set: () => ({ where: () => ({ returning: async () => [{ id: operationId }] }) }) });
  mocks.invoke.mockResolvedValue({ ok: true, output: { receiptId: "test-receipt", amount: 0, approved: false } });
});
function fixture(action: string) {
  const tool = parseToolRegistry(JSON.stringify([{ id: "registered-write", name: "登记操作", action, scope: "business.write", protocol: "mcp-streamable-http", operationKind: "action", endpoint: "http://127.0.0.1:9000/mcp", businessIdempotency: true, businessIdempotencyRetentionMs: 600000, inputSchema: { type: "object" }, outputSchema: { type: "object" } }]))[0];
  const node = WorkflowNode.parse({ id: "write", title: "执行操作", type: "tool", tool: { connector: tool.id, registryToolId: tool.id, action: tool.action, scope: tool.scope, protocol: tool.protocol, operationKind: tool.operationKind, risk: tool.risk, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }, toolOperation: { scope: "registered-write", key: { kind: "input", path: ["requestKey"] } } });
  return { tool, node, runId, input: { requestKey: "key-1" }, outputs: {}, payload: { action, input: { amount: 0 }, outputs: {} } };
}
describe("远端名称进入模拟账本，不访问真实数据库", () => {
  it.each(["_helper", "a".repeat(101), "a".repeat(128)])("完整名称通过账本入口并完整调用 %s", async (action) => {
    expect(await invokeToolOperation(fixture(action))).toMatchObject({ ok: true, reused: false });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.captured?.action).toBe(action);
    expect(mocks.invoke).toHaveBeenCalledWith(expect.objectContaining({ action, input: { amount: 0 } }));
  });
  it("旧普通登记的keyHash和requestHash保持原JSON材料不变", async () => {
    await invokeToolOperation(fixture("record"));
    const keyMaterial = '["00000000-0000-4000-8000-000000000001","registered-write","record","registered-write","key-1"]';
    const requestMaterial = '["mcp-streamable-http","action","http://127.0.0.1:9000/mcp","POST",[],600000,{"action":"record","input":{"amount":0},"outputs":{}}]';
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    expect(mocks.captured?.keyHash).toBe(hash(keyMaterial));
    expect(mocks.captured?.requestHash).toBe(hash(requestMaterial));
  });
  it("绑定或请求名称不一致时仍拒绝，且不进入模拟账本或调用工具", async () => {
    const args = fixture("_helper");
    expect(await invokeToolOperation({ ...args, payload: { ...args.payload, action: "helper" } })).toMatchObject({ ok: false });
    expect(await invokeToolOperation({ ...args, node: { ...args.node, tool: { ...args.node.tool!, action: "helper" } } })).toMatchObject({ ok: false });
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("超界操作名称仍在数据库与网络前拒绝", async () => {
    const args = fixture("record");
    expect(await invokeToolOperation({ ...args, payload: { ...args.payload, action: "a".repeat(129) } })).toMatchObject({ ok: false });
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
