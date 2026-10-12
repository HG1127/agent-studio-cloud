import { describe, expect, it, vi } from "vitest";
import { McpConnectionCheckResult, McpConnectionListResult, type McpConnectionStatus, type McpConnectionView } from "@/contracts/mcp-connection";
import { createMcpCheckBatch, readMcpCheckEntries, reconcileMcpCheckResult, summarizeMcpChecks } from "@/features/connections/mcp-check-batch";

const connections = McpConnectionListResult.parse({ connections: [
  { id: "company.lookup", name: "客户查询" },
  { id: "company.update", name: "客户更新" },
  { id: "company.archive", name: "客户归档" },
] }).connections;
function result(connection: McpConnectionView, status: McpConnectionStatus = "available") {
  return McpConnectionCheckResult.parse({ status, message: "安全检查说明", tools: status === "available" || status === "definition-changed"
    ? [{ registryToolId: connection.id, name: connection.name, status: status === "available" ? "available" : "missing" }] : [] });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("当前登记条目的批量复核控制", () => {
  it("共享契约及真实单项归属必须完整匹配，不能按名称猜服务器", () => {
    expect(readMcpCheckEntries(connections)).toEqual(connections);
    expect(() => readMcpCheckEntries([connections[0], connections[0]])).toThrow();
    expect(() => reconcileMcpCheckResult(connections[0], { status: "available", message: "通过", tools: [] })).toThrow();
    expect(() => reconcileMcpCheckResult(connections[0], { status: "available" })).toThrow();
    expect(() => reconcileMcpCheckResult(connections[0], result(connections[1]))).toThrow();
    expect(() => reconcileMcpCheckResult(connections[0], { ...result(connections[0]), tools: [{ registryToolId: connections[0].id, name: "旧名称", status: "available" }] })).toThrow();
    expect(() => reconcileMcpCheckResult(connections[0], { ...result(connections[0]), tools: [...result(connections[0]).tools, ...result(connections[0]).tools] })).toThrow();
    expect(() => reconcileMcpCheckResult(connections[0], { ...result(connections[0]), status: "definition-changed" })).toThrow();
    expect(() => reconcileMcpCheckResult(connections[0], { ...result(connections[0]), status: "credentials-rejected" })).toThrow();
    expect(reconcileMcpCheckResult(connections[0], result(connections[0], "definition-changed"))).toEqual(result(connections[0], "definition-changed"));
    expect(reconcileMcpCheckResult(connections[0], result(connections[0], "not-found"))).toEqual(result(connections[0], "not-found"));
  });

  it("启动、停止和单项在同一次调用中互斥，停止只阻止后续安排", async () => {
    const pending = deferred<McpConnectionCheckResult>();
    const check = vi.fn<(id: string, signal: AbortSignal) => Promise<McpConnectionCheckResult>>(() => pending.promise);
    const batch = createMcpCheckBatch(connections, check, vi.fn());
    expect(check).not.toHaveBeenCalled();
    expect(batch.startAll()).toBe(true);
    expect(batch.startAll()).toBe(false);
    expect(batch.startOne(connections[1].id)).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
    expect(batch.stop()).toBe(true);
    expect(batch.stop()).toBe(false);
    expect(batch.getSnapshot().phase).toBe("stopping");
    expect(check.mock.calls[0][1].aborted).toBe(false);
    expect(batch.startAll()).toBe(false);
    expect(batch.startOne(connections[0].id)).toBe(false);
    pending.resolve(result(connections[0]));
    await vi.waitFor(() => expect(batch.getSnapshot().phase).toBe("stopped"));
    expect(check).toHaveBeenCalledTimes(1);
    expect(batch.getSnapshot().completed).toBe(1);
    expect(batch.getSnapshot().entries[0].state).toEqual({ kind: "result", result: result(connections[0]) });
    expect(batch.getSnapshot().entries.slice(1).map((entry) => entry.state.kind)).toEqual(["unknown", "unknown"]);
    expect(summarizeMcpChecks(batch.getSnapshot().entries)).toEqual({ passed: 1, failed: 0, unknown: 2 });
    expect(batch.startOne(connections[1].id)).toBe(true);
    await vi.waitFor(() => expect(batch.getSnapshot().phase).toBe("completed"));
    expect(check).toHaveBeenCalledTimes(2);
    expect(batch.getSnapshot().entries[1].state.kind).toBe("uncertain");
    expect(batch.getSnapshot().entries[0].state.kind).toBe("result");
  });

  it("逐项串行继续，保留通过、明确失败与网络未知，不自动重发", async () => {
    const first = deferred<McpConnectionCheckResult>();
    const second = deferred<McpConnectionCheckResult>();
    const third = deferred<McpConnectionCheckResult>();
    const check = vi.fn<(id: string, signal: AbortSignal) => Promise<McpConnectionCheckResult>>()
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const batch = createMcpCheckBatch(connections, check, vi.fn());
    batch.startAll();
    expect(check).toHaveBeenCalledTimes(1);
    first.resolve(result(connections[0]));
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(batch.getSnapshot().entries[0].state.kind).toBe("result");
    second.resolve(result(connections[1], "credentials-rejected"));
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(3));
    third.reject(new Error("private-network-detail"));
    await vi.waitFor(() => expect(batch.getSnapshot().phase).toBe("completed"));
    expect(check.mock.calls.map(([id]) => id)).toEqual(connections.map((connection) => connection.id));
    expect(summarizeMcpChecks(batch.getSnapshot().entries)).toEqual({ passed: 1, failed: 1, unknown: 1 });
    expect(batch.getSnapshot().completed).toBe(3);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("检查状态发布后立即停止时，不发出尚未开始的请求或遗留检查中状态", () => {
    const check = vi.fn<(id: string, signal: AbortSignal) => Promise<McpConnectionCheckResult>>();
    let batch!: ReturnType<typeof createMcpCheckBatch>;
    batch = createMcpCheckBatch(connections, check, (snapshot) => { if (snapshot.activeId) batch.stop(); });
    expect(batch.startAll()).toBe(true);
    expect(check).not.toHaveBeenCalled();
    expect(batch.getSnapshot().phase).toBe("stopped");
    expect(batch.getSnapshot().completed).toBe(0);
    expect(batch.getSnapshot().entries.every((entry) => entry.state.kind === "unknown")).toBe(true);
  });

  it("停止第二项后仍接收该项明确失败，第三项保留此前准确结果", async () => {
    const second = deferred<McpConnectionCheckResult>();
    const check = vi.fn<(id: string, signal: AbortSignal) => Promise<McpConnectionCheckResult>>()
      .mockResolvedValueOnce(result(connections[2])).mockResolvedValueOnce(result(connections[0])).mockReturnValueOnce(second.promise);
    const batch = createMcpCheckBatch(connections, check, vi.fn());
    batch.startOne(connections[2].id);
    await vi.waitFor(() => expect(batch.getSnapshot().phase).toBe("completed"));
    batch.startAll();
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(3));
    batch.stop();
    second.resolve(result(connections[1], "definition-changed"));
    await vi.waitFor(() => expect(batch.getSnapshot().phase).toBe("stopped"));
    expect(batch.getSnapshot().completed).toBe(2);
    expect(batch.getSnapshot().entries[2].state).toEqual({ kind: "result", result: result(connections[2]) });
    expect(summarizeMcpChecks(batch.getSnapshot().entries)).toEqual({ passed: 2, failed: 1, unknown: 0 });
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("归属范围经过甲到乙再到甲时，旧回复不写入新范围或安排后续", async () => {
    const oldReply = deferred<McpConnectionCheckResult>();
    const oldPublish = vi.fn();
    const oldCheck = vi.fn<(id: string, signal: AbortSignal) => Promise<McpConnectionCheckResult>>().mockReturnValue(oldReply.promise);
    const firstScope = createMcpCheckBatch(connections, oldCheck, oldPublish);
    firstScope.startAll();
    firstScope.dispose();
    const otherScope = createMcpCheckBatch([{ id: connections[0].id, name: "另一归属登记" }], vi.fn(), vi.fn());
    otherScope.dispose();
    const lastPublish = vi.fn();
    const lastScope = createMcpCheckBatch(connections, vi.fn(), lastPublish);
    const publications = oldPublish.mock.calls.length;
    oldReply.resolve(result(connections[0]));
    await oldReply.promise;
    await Promise.resolve();
    expect(oldCheck.mock.calls[0][1].aborted).toBe(true);
    expect(oldCheck).toHaveBeenCalledTimes(1);
    expect(oldPublish).toHaveBeenCalledTimes(publications);
    expect(lastPublish).not.toHaveBeenCalled();
    expect(lastScope.getSnapshot().entries.every((entry) => entry.state.kind === "unknown")).toBe(true);
    expect(firstScope.startAll()).toBe(false);
  });

  it("不把服务端暂不可用计为通过，也不把上次通过当成本次回复", async () => {
    const check = vi.fn<(id: string, signal: AbortSignal) => Promise<McpConnectionCheckResult>>()
      .mockResolvedValueOnce(result(connections[0])).mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(result(connections[0], "unavailable"));
    const batch = createMcpCheckBatch([connections[0]], check, vi.fn());
    batch.startOne(connections[0].id);
    await vi.waitFor(() => expect(batch.getSnapshot().phase).toBe("completed"));
    batch.startOne(connections[0].id);
    await vi.waitFor(() => expect(batch.getSnapshot().phase).toBe("completed"));
    expect(batch.getSnapshot().entries[0].state).toEqual({ kind: "uncertain", previous: result(connections[0]) });
    expect(summarizeMcpChecks(batch.getSnapshot().entries)).toEqual({ passed: 0, failed: 0, unknown: 1 });
    batch.startOne(connections[0].id);
    await vi.waitFor(() => expect(batch.getSnapshot().phase).toBe("completed"));
    expect(summarizeMcpChecks(batch.getSnapshot().entries)).toEqual({ passed: 0, failed: 0, unknown: 1 });
    expect(check).toHaveBeenCalledTimes(3);
  });
});
