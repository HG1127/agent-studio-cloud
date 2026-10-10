import { describe, expect, it, vi } from "vitest";
import { DefaultResultStreamFrame, MAX_DEFAULT_RESULT_FRAME_BYTES, MAX_DEFAULT_RESULT_OBSERVED_FRAMES, type DefaultResultStreamObservation } from "@/contracts/default-result-stream";
import { MAX_RUN_RESULT_BYTES } from "@/contracts/run";
import { classifyDefaultResultFrame, decideDefaultResultStream, freezeDefaultResultFrame } from "./default-result-stream";

const RUN = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "123e4567-e89b-42d3-a456-426614174001";
const FINISHED = "2026-10-10T03:00:00.000Z";
const WORKSPACE = "123e4567-e89b-42d3-a456-426614174002";
const freeze = (...values: [] | [unknown]) => freezeDefaultResultFrame({ runId: RUN, status: "completed", outcome: "completed", finishedAt: FINISHED, result: values.length === 0 ? { amount: 0, approved: false } : values[0] });
const observation = (overrides: Partial<DefaultResultStreamObservation> = {}): DefaultResultStreamObservation => ({
  workspaceId: WORKSPACE, runId: RUN, frameHash: "1".repeat(64), sdkRunId: "wrun_owner", metadata: { done: false, tailIndex: -1 }, readStatus: "verified_snapshot",
  matchedFrames: 0, conflictingFrames: 0, producerSettled: true, ...overrides,
});
const decide = (value = observation(), sendAttempts = 0, root = true, sdkRunId = "wrun_owner") => decideDefaultResultStream({ owner: { workspaceId: WORKSPACE, runId: RUN, sdkRunId, root, frameHash: "1".repeat(64) }, observation: value, sendAttempts });

describe("冻结默认成果帧", () => {
  it("以同一任务标识冻结真实结果，保留零与否定值", () => {
    const result = { amount: 0, approved: false };
    const frozen = freeze(result);
    expect(frozen.frame).toEqual({ schemaVersion: 1, kind: "run.result", frameId: RUN, runId: RUN, status: "completed", outcome: "completed", finishedAt: FINISHED, result });
    expect(frozen.frameHash).toMatch(/^[0-9a-f]{64}$/);
    expect(classifyDefaultResultFrame(frozen, frozen.frame)).toBe("match");
  });
  it("对象键顺序不制造新的成果身份，数组顺序仍有业务含义", () => {
    expect(freeze({ b: 2, a: [0, false] }).frameHash).toBe(freeze({ a: [0, false], b: 2 }).frameHash);
    expect(freeze({ a: [0, false] }).frameHash).not.toBe(freeze({ a: [false, 0] }).frameHash);
  });
  it.each(["queued", "running", "waiting_approval", "waiting_event", "failed", "cancelled"] as const)("非完成状态 %s 不能虚报成果", (status) => {
    expect(() => freezeDefaultResultFrame({ runId: RUN, status, outcome: "completed", finishedAt: FINISHED, result: { draft: true } })).toThrow();
  });
  it("完成时间缺失不能用当前时间代替", () => {
    expect(() => freezeDefaultResultFrame({ runId: RUN, status: "completed", outcome: "completed", finishedAt: null, result: {} })).toThrow();
  });
  it("拒绝确认的结束不是批准或业务交付成功", () => {
    const frozen = freezeDefaultResultFrame({ runId: RUN, status: "completed", outcome: "not_approved", finishedAt: FINISHED, result: { 处理状态: "未获确认" } });
    expect(frozen.frame.outcome).toBe("not_approved");
    expect(classifyDefaultResultFrame(frozen, { ...frozen.frame, outcome: "completed" })).toBe("conflict");
  });
  it("哈希排序不依赖宿主语言排序", () => {
    const locale = vi.spyOn(String.prototype, "localeCompare").mockImplementation((left) => String(left).length);
    try {
      expect(freeze({ A: 1, a: 2, z: 3, é: 4 }).frameHash).toBe(freeze({ é: 4, z: 3, a: 2, A: 1 }).frameHash);
    } finally { locale.mockRestore(); }
  });
  it("从完整合法两兆字节结果构造帧时不挤占结果容量", () => {
    const result = { text: "x".repeat(MAX_RUN_RESULT_BYTES - 11) };
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBe(MAX_RUN_RESULT_BYTES);
    const frozen = freeze(result);
    expect(new TextEncoder().encode(JSON.stringify(frozen.frame)).byteLength).toBeLessThanOrEqual(MAX_DEFAULT_RESULT_FRAME_BYTES);
    expect(() => freeze({ text: result.text + "x" })).toThrow();
  });
  it("结果自身三十二层与五万项限制不受帧包装挤占", () => {
    let result: unknown = { leaf: 0 };
    for (let depth = 0; depth < 31; depth += 1) result = { child: result };
    const deepest = freeze(result);
    expect(classifyDefaultResultFrame(deepest, deepest.frame)).toBe("match");
    expect(() => freeze({ child: result })).toThrow();
    const largest = freeze({ list: Array.from({ length: 49_998 }, () => false) });
    expect(classifyDefaultResultFrame(largest, largest.frame)).toBe("match");
    expect(() => freeze({ list: Array.from({ length: 49_999 }, () => false) })).toThrow();
  });
  it("冻结副本不随调用者后来改写变化", () => {
    const original = { item: { quantity: 0 } };
    const frozen = freeze(original);
    original.item.quantity = 2;
    expect(frozen.frame.result).toEqual({ item: { quantity: 0 } });
    expect(classifyDefaultResultFrame(frozen, frozen.frame)).toBe("match");
  });
  it.each([null, [], undefined, { n: Infinity }, { v: undefined }, new Date()])("拒绝非可持久成果 %#", (value) => {
    expect(() => freeze(value)).toThrow();
  });
  it("缺失成果字段不能替换成默认成果", () => {
    expect(DefaultResultStreamFrame.safeParse({ schemaVersion: 1, kind: "run.result", frameId: RUN, runId: RUN, status: "completed", outcome: "completed", finishedAt: FINISHED }).success).toBe(false);
  });
  it("拒绝执行访问器或隐藏序列化函数", () => {
    const getter = vi.fn(() => "secret");
    const serialize = vi.fn(() => ({ changed: true }));
    const accessor = Object.defineProperty({}, "text", { enumerable: true, get: getter });
    const serializer = Object.defineProperty({ text: "ok" }, "toJSON", { value: serialize });
    expect(() => freeze(accessor)).toThrow();
    expect(() => freeze(serializer)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(serialize).not.toHaveBeenCalled();
  });
  it("拒绝凭据而非改变已冻结的业务正文", () => {
    expect(() => freeze({ apiKey: "not-for-results" })).toThrow("未隐藏");
    expect(() => freeze({ text: "Bearer abcdefghijklmnop" })).toThrow("未隐藏");
    expect(() => freeze({ apiKey: "[已隐藏敏感信息]", inputTokens: 3 })).not.toThrow();
  });
  it("只有相同任务、相同正文和相同哈希可以逻辑去重", () => {
    const frozen = freeze();
    expect(classifyDefaultResultFrame(frozen, { ...frozen.frame, runId: OTHER, frameId: OTHER })).toBe("conflict");
    expect(classifyDefaultResultFrame(frozen, { ...frozen.frame, result: { amount: 1 } })).toBe("conflict");
    expect(classifyDefaultResultFrame({ ...frozen, frameHash: "0".repeat(64) }, frozen.frame)).toBe("conflict");
    expect(DefaultResultStreamFrame.safeParse({ ...frozen.frame, frameId: OTHER }).success).toBe(false);
  });
  it("冻结期望帧本身也不得含访问器、隐藏函数或符号", () => {
    const frozen = freeze();
    const getter = vi.fn(() => frozen.frameHash);
    const serializer = vi.fn(() => frozen.frame);
    const accessed = Object.defineProperty({ frame: frozen.frame }, "frameHash", { enumerable: true, get: getter });
    const withSerializer = Object.defineProperty({ ...frozen.frame }, "toJSON", { value: serializer });
    const withSymbol = Object.defineProperty({ ...frozen.frame }, Symbol("hidden"), { value: 0 });
    expect(classifyDefaultResultFrame(accessed as typeof frozen, frozen.frame)).toBe("conflict");
    expect(classifyDefaultResultFrame({ ...frozen, frame: withSerializer }, frozen.frame)).toBe("conflict");
    expect(classifyDefaultResultFrame({ ...frozen, frame: withSymbol }, frozen.frame)).toBe("conflict");
    expect(getter).not.toHaveBeenCalled();
    expect(serializer).not.toHaveBeenCalled();
  });
  it("期望正文的非有限数字或访问器不能借 JSON 空值保持原哈希", () => {
    const invalidNumber = freeze({ n: null });
    const validFrame = structuredClone(invalidNumber.frame);
    invalidNumber.frame.result.n = NaN;
    expect(classifyDefaultResultFrame(invalidNumber, validFrame)).toBe("conflict");
    const accessor = freeze({ n: null });
    const getter = vi.fn(() => null);
    Object.defineProperty(accessor.frame.result, "n", { enumerable: true, get: getter });
    expect(classifyDefaultResultFrame(accessor, validFrame)).toBe("conflict");
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("默认成果流补送判定", () => {
  it("仅明确空、未关闭且前次生产结束时允许发送", () => {
    expect(decide().kind).toBe("write");
    expect(decide(observation({ producerSettled: false })).kind).toBe("wait");
    expect(decide(observation({ metadata: null })).kind).toBe("verify");
    expect(decide(observation({ readStatus: "unavailable" })).kind).toBe("verify");
  });
  it("已读回正确帧只关闭，不重新写入", () => {
    expect(decide(observation({ matchedFrames: 1, metadata: { done: false, tailIndex: 0 } })).kind).toBe("close");
  });
  it("同一帧重复可去重，但必须确认全部读回和真正关闭", () => {
    expect(decide(observation({ matchedFrames: 2, metadata: { done: true, tailIndex: 1 } })).kind).toBe("confirmed");
    expect(decide(observation({ matchedFrames: 1, metadata: { done: true, tailIndex: 1 } })).kind).toBe("verify");
    expect(decide(observation({ matchedFrames: 1, metadata: null })).kind).toBe("verify");
  });
  it("观察上限内仍可核对，超出上限不能无限要求无法完成的读回", () => {
    const cap = MAX_DEFAULT_RESULT_OBSERVED_FRAMES;
    expect(decide(observation({ matchedFrames: cap, metadata: { done: true, tailIndex: cap - 1 } })).kind).toBe("confirmed");
    expect(decide(observation({ matchedFrames: cap - 1, metadata: { done: true, tailIndex: cap - 1 } })).kind).toBe("verify");
    for (const done of [false, true]) {
      expect(decide(observation({ matchedFrames: cap, metadata: { done, tailIndex: cap } })).kind).toBe("failed");
    }
    expect(decide(observation({ producerSettled: false, metadata: { done: false, tailIndex: cap } })).kind).toBe("failed");
  });
  it("不把关闭后的缺帧或不完整帧当成可以补写", () => {
    expect(decide(observation({ metadata: { done: true, tailIndex: -1 } })).kind).toBe("failed");
    expect(decide(observation({ readStatus: "partial", metadata: { done: true, tailIndex: 0 } })).kind).toBe("failed");
    expect(decide(observation({ readStatus: "partial", metadata: { done: false, tailIndex: 0 } })).kind).toBe("verify");
  });
  it("冲突、子流程和不同引擎归属均不得发送或关闭", () => {
    expect(decide(observation({ conflictingFrames: 1 })).kind).toBe("failed");
    expect(decide(observation(), 0, false).kind).toBe("failed");
    expect(decide(observation({ sdkRunId: "wrun_other" })).kind).toBe("failed");
    expect(decide(observation({ runId: OTHER })).kind).toBe("failed");
    expect(decide(observation({ frameHash: "2".repeat(64) })).kind).toBe("failed");
    expect(decide(observation({ workspaceId: OTHER })).kind).toBe("failed");
  });
  it("次数耗尽禁止再写，但允许核对已经送达的成果", () => {
    expect(decide(observation(), 5).kind).toBe("failed");
    expect(decide(observation({ matchedFrames: 1, metadata: { done: true, tailIndex: 0 } }), 5).kind).toBe("confirmed");
    expect(() => decide(observation(), -1)).toThrow("次数无效");
    expect(() => decide(observation(), 6)).toThrow("次数无效");
  });
});
