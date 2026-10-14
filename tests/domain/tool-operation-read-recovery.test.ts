import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolOperationResolveInput, ToolOperationResolution, ToolOperationView, type ToolOperationGetResult } from "@/contracts/tool-operation";
import { canonicalJson } from "@/server/domain/canonical-json";
import { bindToolOperationReadRequest, copyToolOperationReadPayload, matchToolOperationReadEvidence } from "@/features/tool-operations/tool-operation-read-evidence";
import { createToolOperationHistoryReader } from "@/features/tool-operations/tool-operation-history-reader";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const sourceRunId = id(2);
function payload(request = 3): ToolOperationResolveInput {
  return ToolOperationResolveInput.parse({
    operationId: id(1), requestId: id(request), kind: "record-receipt", confirmedCompleted: true,
    reason: "已查询业务系统的原登记记录", receipt: { order: "登记示例", nested: { count: 0, confirmed: false }, items: ["第一项", "第二项"] },
  });
}
const digest = (input: ToolOperationResolveInput) => createHash("sha256").update(canonicalJson(ToolOperationResolveInput.parse(input))).digest("hex");
function resolution(input: ToolOperationResolveInput) {
  return ToolOperationResolution.parse({
    requestId: input.requestId, kind: input.kind, reason: input.reason, requestHash: digest(input),
    createdBy: id(4), createdAt: "2026-10-10T01:00:00.000Z",
  });
}
function operation(records: ToolOperationResolution[] = [], overrides: Partial<ToolOperationView> = {}) {
  return ToolOperationView.parse({
    id: id(1), sourceRunId, nodeTitle: "登记步骤", toolId: "registered-tool", status: "blocked", error: null, receipt: null,
    retryDeadline: "2026-10-11T01:00:00.000Z", createdAt: "2026-10-10T01:00:00.000Z", updatedAt: "2026-10-10T01:00:00.000Z",
    resolutions: records, ...overrides,
  });
}
const found = (input: ToolOperationResolveInput): ToolOperationGetResult => ({ ok: true, operation: operation([resolution(input)]) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
function client(read: (operationId: string, signal: AbortSignal) => Promise<ToolOperationGetResult>) {
  return { read: vi.fn(read), hashPayload: vi.fn(async (input: ToolOperationResolveInput): Promise<string | null> => digest(input)), onRecorded: vi.fn() };
}
afterEach(() => vi.useRealTimers());

describe("完整原提交与同请求证据", () => {
  it("绑定完整回执和来源的独立副本，之后修改调用方对象不改原提交", () => {
    const input = payload();
    const expected = copyToolOperationReadPayload(input);
    const bound = bindToolOperationReadRequest(input, sourceRunId, 1);
    expect(bound?.payload).toEqual(expected);
    expect(bound?.payload).not.toBe(input);
    if (input.kind !== "record-receipt") throw new Error("Fixture mismatch");
    input.receipt.nested = { count: 9 };
    expect(bound?.payload).toEqual(expected);
    expect(matchToolOperationReadEvidence(bound, found(expected), digest(expected))).toEqual(operation([resolution(expected)]));
  });

  it("只有唯一同请求、同种类、完整实际摘要和来源精确一致才提供记录", () => {
    const input = payload();
    const bound = bindToolOperationReadRequest(input, sourceRunId, 1);
    expect(matchToolOperationReadEvidence(bound, found(input), digest(input))?.resolutions).toEqual([resolution(input)]);
    const changed = copyToolOperationReadPayload(input);
    changed.reason = "另一次业务系统核对的说明";
    expect(digest(changed)).not.toBe(digest(input));
    expect(matchToolOperationReadEvidence(bound, found(input), digest(changed))).toBeNull();
    if (changed.kind !== "record-receipt") throw new Error("Fixture mismatch");
    changed.receipt.items = ["另一个实际回执"];
    expect(matchToolOperationReadEvidence(bound, found(input), digest(changed))).toBeNull();
  });

  it("原允许后续尝试请求也只核对原完整登记，不证明业务执行状态", () => {
    const input = ToolOperationResolveInput.parse({
      operationId: id(1), requestId: id(5), kind: "retry", confirmedNotExecuted: true, reason: "已在业务系统核对本次登记",
    });
    const bound = bindToolOperationReadRequest(input, sourceRunId, 2);
    const observed = matchToolOperationReadEvidence(bound, found(input), digest(input));
    expect(observed?.status).toBe("blocked");
    expect(observed?.resolutions[0]).toEqual(resolution(input));
    expect(bound?.payload).toEqual(input);
  });

  it.each(["operation", "source", "request", "kind", "hash"] as const)("历史 %s 不一致仍未知", (field) => {
    const input = payload();
    const record = resolution(input);
    const view = operation([{
      ...record, requestId: field === "request" ? id(9) : record.requestId,
      kind: field === "kind" ? "retry" : record.kind, requestHash: field === "hash" ? "a".repeat(64) : record.requestHash,
    }], { id: field === "operation" ? id(8) : id(1), sourceRunId: field === "source" ? id(7) : sourceRunId });
    expect(matchToolOperationReadEvidence(bindToolOperationReadRequest(input, sourceRunId, 1), { ok: true, operation: view }, digest(input))).toBeNull();
  });

  it("未读到、读取失败、没有历史及业务状态完成均不能证明原请求已登记", () => {
    const input = payload();
    const bound = bindToolOperationReadRequest(input, sourceRunId, 1);
    for (const reply of [null, { ok: false, error: "未取得" }, { ok: true, operation: operation() }, { ok: true, operation: operation([], { status: "completed" }) }]) {
      expect(matchToolOperationReadEvidence(bound, reply, digest(input))).toBeNull();
    }
  });

  it("摘要缺失、无法计算或格式无效时保持未知", () => {
    const input = payload();
    const bound = bindToolOperationReadRequest(input, sourceRunId, 1);
    expect(matchToolOperationReadEvidence(bound, found(input), null)).toBeNull();
    expect(matchToolOperationReadEvidence(bound, found(input), "not-a-digest")).toBeNull();
    const { requestHash: omittedHash, ...incomplete } = resolution(input);
    expect(omittedHash).toBe(digest(input));
    expect(matchToolOperationReadEvidence(bound, { ok: true, operation: { ...operation(), resolutions: [incomplete] } }, digest(input))).toBeNull();
  });

  it("重复同请求摘要与50条覆盖边界不能解除未知保护", () => {
    const input = payload();
    const record = resolution(input);
    const bound = bindToolOperationReadRequest(input, sourceRunId, 1);
    expect(matchToolOperationReadEvidence(bound, { ok: true, operation: operation([record, record]) }, digest(input))).toBeNull();
    const full = [record, ...Array.from({ length: 49 }, (_, index) => ({ ...record, requestId: id(100 + index) }))];
    expect(matchToolOperationReadEvidence(bound, { ok: true, operation: operation(full) }, digest(input))).toBeNull();
  });

  it("原请求格式、来源和代次无效不能成为可读取绑定", () => {
    const input = payload();
    expect(bindToolOperationReadRequest(input, "invalid-source", 1)).toBeNull();
    for (const generation of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(bindToolOperationReadRequest(input, sourceRunId, generation)).toBeNull();
    }
    expect(bindToolOperationReadRequest({ ...input, requestId: "invalid-request" }, sourceRunId, 1)).toBeNull();
  });
});

describe("只读慢读与代次隔离", () => {
  it("慢读不自动重试，中止只读信号后可手动重读，迟到旧结果忽略", async () => {
    vi.useFakeTimers();
    const input = payload();
    const first = deferred<ToolOperationGetResult>();
    const second = deferred<ToolOperationGetResult>();
    const clients = client(() => first.promise);
    clients.read.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const reader = createToolOperationHistoryReader();
    reader.connect(); reader.bind(input, sourceRunId, 1, true, clients);
    expect(clients.read).not.toHaveBeenCalled();
    const firstRead = reader.read();
    expect(clients.read).toHaveBeenCalledWith(input.operationId, expect.any(AbortSignal));
    await reader.read();
    expect(clients.read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(reader.getSnapshot()).toMatchObject({ phase: "slow", canAbort: true, canRead: false });
    expect(clients.read).toHaveBeenCalledTimes(1);
    reader.abort();
    expect(clients.read.mock.calls[0][1].aborted).toBe(true);
    expect(reader.getSnapshot()).toMatchObject({ phase: "unknown", canRead: true, canAbort: false });
    expect(vi.getTimerCount()).toBe(0);
    const secondRead = reader.read();
    first.resolve(found(input)); await firstRead;
    expect(reader.getSnapshot().phase).toBe("reading");
    expect(clients.onRecorded).not.toHaveBeenCalled();
    second.resolve(found(input)); await secondRead;
    expect(clients.onRecorded).toHaveBeenCalledOnce();
    expect(clients.onRecorded).toHaveBeenCalledWith(operation([resolution(input)]), input, sourceRunId, 1);
    expect(reader.getSnapshot()).toMatchObject({ phase: "recorded", canRead: true, canAbort: false });
    expect(vi.getTimerCount()).toBe(0);
    reader.disconnect();
  });

  it("A→B→A使用新代次，前两次迟到响应不能交给当前请求", async () => {
    const a = payload(3), b = payload(9);
    const responses = [deferred<ToolOperationGetResult>(), deferred<ToolOperationGetResult>(), deferred<ToolOperationGetResult>()];
    const clients = client(() => responses[0].promise);
    for (const response of responses) clients.read.mockImplementationOnce(() => response.promise);
    const reader = createToolOperationHistoryReader();
    reader.connect(); reader.bind(a, sourceRunId, 1, true, clients);
    const readA = reader.read();
    reader.bind(b, sourceRunId, 2, true, clients);
    expect(clients.read.mock.calls[0][1].aborted).toBe(true);
    expect(clients.read).toHaveBeenCalledTimes(1);
    const readB = reader.read();
    reader.bind(a, sourceRunId, 3, true, clients);
    expect(clients.read.mock.calls[1][1].aborted).toBe(true);
    const current = reader.read();
    responses[0].resolve(found(a)); responses[1].resolve(found(b));
    await Promise.all([readA, readB]);
    expect(clients.onRecorded).not.toHaveBeenCalled();
    expect(reader.getSnapshot().phase).toBe("reading");
    responses[2].resolve(found(a)); await current;
    expect(clients.onRecorded).toHaveBeenCalledWith(expect.anything(), a, sourceRunId, 3);
    expect(clients.hashPayload).toHaveBeenCalledOnce();
    reader.disconnect();
  });

  it("同代次改内容或来源、倒退代次及ABA复用都被阻止，须更高代次恢复", async () => {
    const input = payload();
    const clients = client(async () => found(input));
    const reader = createToolOperationHistoryReader();
    reader.connect(); reader.bind(input, sourceRunId, 4, true, clients);
    const changed = copyToolOperationReadPayload(input);
    changed.reason = "同代次中被更换的核对内容";
    reader.bind(changed, sourceRunId, 4, true, clients);
    await reader.read();
    expect(reader.getSnapshot().canRead).toBe(false);
    reader.bind(input, sourceRunId, 4, true, clients);
    await reader.read();
    expect(clients.read).not.toHaveBeenCalled();
    reader.bind(input, id(7), 5, true, clients);
    reader.bind(input, sourceRunId, 5, true, clients);
    await reader.read();
    expect(clients.read).not.toHaveBeenCalled();
    reader.bind(input, sourceRunId, 3, true, clients);
    await reader.read();
    expect(clients.read).not.toHaveBeenCalled();
    reader.bind(input, sourceRunId, 6, true, clients);
    await reader.read();
    expect(clients.onRecorded).toHaveBeenCalledWith(expect.anything(), input, sourceRunId, 6);
    reader.disconnect();
  });

  it("摘要计算迟到也受中止与代次保护", async () => {
    const input = payload();
    const hash = deferred<string | null>();
    const clients = client(async () => found(input));
    clients.hashPayload.mockImplementation(() => hash.promise);
    const reader = createToolOperationHistoryReader();
    reader.connect(); reader.bind(input, sourceRunId, 1, true, clients);
    const pending = reader.read();
    await Promise.resolve();
    expect(clients.hashPayload).toHaveBeenCalledOnce();
    reader.abort(); hash.resolve(digest(input)); await pending;
    expect(clients.onRecorded).not.toHaveBeenCalled();
    expect(reader.getSnapshot().phase).toBe("unknown");
    reader.disconnect();
  });

  it("卸载中止控制器并清理计时器，卸载后结果和再次读取都忽略", async () => {
    vi.useFakeTimers();
    const input = payload();
    const response = deferred<ToolOperationGetResult>();
    const clients = client(() => response.promise);
    const listener = vi.fn();
    const reader = createToolOperationHistoryReader();
    reader.connect(); reader.bind(input, sourceRunId, 1, true, clients);
    const unsubscribe = reader.subscribe(listener);
    const pending = reader.read();
    reader.disconnect(); listener.mockClear();
    expect(clients.read.mock.calls[0][1].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    response.resolve(found(input)); await pending;
    await reader.read();
    expect(listener).not.toHaveBeenCalled();
    expect(clients.hashPayload).not.toHaveBeenCalled();
    expect(clients.onRecorded).not.toHaveBeenCalled();
    expect(clients.read).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("原提交仍在进行时不能读，重新禁用后迟到结果不能确认", async () => {
    const input = payload();
    const response = deferred<ToolOperationGetResult>();
    const clients = client(() => response.promise);
    const reader = createToolOperationHistoryReader();
    reader.connect(); reader.bind(input, sourceRunId, 1, false, clients);
    await reader.read();
    expect(clients.read).not.toHaveBeenCalled();
    reader.bind(input, sourceRunId, 1, true, clients);
    const pending = reader.read();
    reader.bind(input, sourceRunId, 1, false, clients);
    expect(clients.read.mock.calls[0][1].aborted).toBe(true);
    response.resolve(found(input)); await pending;
    expect(clients.onRecorded).not.toHaveBeenCalled();
    expect(reader.getSnapshot().canRead).toBe(false);
    reader.disconnect();
  });

  it("失败和不完整响应保持未知，可手动继续，绝不自动重读", async () => {
    const input = payload();
    const clients = client(async () => { throw new Error("仅供内部调试的读取内容"); });
    const reader = createToolOperationHistoryReader();
    reader.connect(); reader.bind(input, sourceRunId, 1, true, clients);
    await reader.read();
    expect(reader.getSnapshot()).toMatchObject({ phase: "unknown", canRead: true, canAbort: false });
    expect(reader.getSnapshot().message).not.toContain("内部调试");
    expect(clients.read).toHaveBeenCalledOnce();
    expect(clients.onRecorded).not.toHaveBeenCalled();
    reader.disconnect();
  });

  it("摘要回调改变自己的副本不能更换原固定内容，也不能误认登记", async () => {
    const input = payload();
    const expected = copyToolOperationReadPayload(input);
    const clients = client(async () => found(expected));
    clients.hashPayload.mockImplementation(async (copy) => {
      copy.reason = "回调中被更换的核对说明";
      if (copy.kind === "record-receipt") copy.receipt.items = ["回调自己的副本"];
      return digest(copy);
    });
    const reader = createToolOperationHistoryReader();
    reader.connect(); reader.bind(input, sourceRunId, 1, true, clients);
    await reader.read();
    expect(input).toEqual(expected);
    expect(clients.onRecorded).not.toHaveBeenCalled();
    expect(reader.getSnapshot().phase).toBe("unknown");
    reader.disconnect();
  });
});
