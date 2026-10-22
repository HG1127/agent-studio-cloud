import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DefaultResultStreamOwner, FrozenDefaultResultFrame } from "@/contracts/default-result-stream";
import { freezeDefaultResultFrame } from "@/server/domain/runtime/default-result-stream";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(), getWorld: vi.fn(), getInfo: vi.fn(), getTailIndex: vi.fn(),
  getReadable: vi.fn(), getWritable: vi.fn(), read: vi.fn(), cancel: vi.fn(),
  releaseReader: vi.fn(), write: vi.fn(), close: vi.fn(), abort: vi.fn(), releaseWriter: vi.fn(),
}));
vi.mock("workflow/api", () => ({ getRun: mocks.getRun }));
vi.mock("workflow/runtime", () => ({ getWorld: mocks.getWorld }));
vi.mock("@/lib/db", () => { throw new Error("SDK 适配不能访问数据库"); });
vi.mock("@/server/workflows/agent-run", () => { throw new Error("成果补送不能导入业务工作流"); });
vi.mock("@/server/services/model-call", () => { throw new Error("成果补送不能调用模型"); });
vi.mock("@/server/tools/invoke-http-tool", () => { throw new Error("成果补送不能执行业务工具"); });

import {
  closeDefaultResultStream, DefaultResultStreamSdkError, observeDefaultResultStream, writeDefaultResultStreamFrame,
} from "./default-result-stream-sdk";

const RUN_ID = "00000000-0000-4000-8000-0000000000d1";
const SDK_ID = "wrun_01K7MFEY700000000000000001";
let frozen: FrozenDefaultResultFrame;
let owner: DefaultResultStreamOwner;
let frames: unknown[];
let closed: boolean;
let sdkStatus: string;
let readIndex: number;

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const input = () => ({ owner, frozen, producerSettled: true, timeoutMs: 100, sendAttempts: 0 });

beforeEach(() => {
  vi.useRealTimers();
  for (const mock of Object.values(mocks)) mock.mockReset();
  frozen = freezeDefaultResultFrame({ runId: RUN_ID, status: "completed", outcome: "completed", finishedAt: "2026-10-12T00:00:00.000Z", result: { amount: 0, approved: false } });
  owner = { workspaceId: "00000000-0000-4000-8000-000000000001", runId: RUN_ID, sdkRunId: SDK_ID, root: true, frameHash: frozen.frameHash };
  frames = [];
  closed = false;
  sdkStatus = "running";
  readIndex = 0;
  mocks.getRun.mockImplementation((runId: string) => ({
    runId, get exists() { return Promise.resolve(true); }, get status() { return Promise.resolve(sdkStatus); },
    getReadable: mocks.getReadable, getWritable: mocks.getWritable,
  }));
  mocks.getWorld.mockResolvedValue({ streams: { getInfo: mocks.getInfo } });
  mocks.getInfo.mockImplementation(async () => ({ done: closed, tailIndex: frames.length - 1 }));
  mocks.getTailIndex.mockImplementation(async () => frames.length - 1);
  mocks.getReadable.mockImplementation(() => {
    readIndex = 0;
    return { getTailIndex: mocks.getTailIndex, cancel: mocks.cancel, getReader: () => ({ read: mocks.read, cancel: mocks.cancel, releaseLock: mocks.releaseReader }) };
  });
  mocks.read.mockImplementation(async () => readIndex < frames.length
    ? { done: false, value: frames[readIndex++] }
    : { done: true, value: undefined });
  mocks.cancel.mockResolvedValue(undefined);
  mocks.abort.mockResolvedValue(undefined);
  mocks.getWritable.mockImplementation(({ ops }: { ops: Promise<unknown>[] }) => {
    ops.push(Promise.resolve());
    return { getWriter: () => ({ write: mocks.write, close: mocks.close, abort: mocks.abort, releaseLock: mocks.releaseWriter }) };
  });
  mocks.write.mockImplementation(async (frame: unknown) => { frames.push(frame); });
  mocks.close.mockImplementation(async () => { closed = true; });
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("实际根运行默认流的公开 SDK 适配", () => {
  it("只针对实际 SDK 根标识核对默认名称，保留调用方持久化的生产停止证据", async () => {
    const observation = await observeDefaultResultStream({ ...input(), producerSettled: false });
    expect(observation).toMatchObject({ metadata: { done: false, tailIndex: -1 }, readStatus: "verified_snapshot", producerSettled: false });
    expect(mocks.getRun).toHaveBeenCalledWith(SDK_ID);
    expect(mocks.getInfo).toHaveBeenCalledWith(SDK_ID, "strm_01K7MFEY700000000000000001_user");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it("单个结构化成果只通过公开 writable 写入，释放锁且读回之后才返回明确证据", async () => {
    const result = await writeDefaultResultStreamFrame(input());
    expect(result).toMatchObject({ matchedFrames: 1, conflictingFrames: 0, producerSettled: true, readStatus: "verified_snapshot", metadata: { done: false, tailIndex: 0 } });
    expect(mocks.write).toHaveBeenCalledWith(frozen.frame);
    expect(mocks.releaseWriter).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.releaseReader).toHaveBeenCalledOnce();
    const options = mocks.getWritable.mock.calls[0][0];
    expect(Object.keys(options)).toEqual(["ops"]);
    expect(options.ops).toHaveLength(1);
  });

  it("完整相同物理重复帧可核对，随后只关闭而不再次写入", async () => {
    frames = [frozen.frame, structuredClone(frozen.frame)];
    await expect(closeDefaultResultStream(input())).resolves.toMatchObject({ matchedFrames: 2, readStatus: "verified_snapshot", metadata: { done: true, tailIndex: 1 } });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.releaseWriter).toHaveBeenCalledOnce();
  });

  it("关闭后的缺帧不能补送或重复关闭", async () => {
    closed = true;
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "decision-rejected", acknowledgement: "none" });
    await expect(closeDefaultResultStream(input())).rejects.toMatchObject({ code: "decision-rejected", acknowledgement: "none" });
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it("已有完整关闭成果只读核对，不重复向关闭的提供器提交关闭", async () => {
    frames = [frozen.frame]; closed = true; sdkStatus = "completed";
    await expect(observeDefaultResultStream(input())).resolves.toMatchObject({ readStatus: "verified_snapshot", metadata: { done: true, tailIndex: 0 } });
    await expect(closeDefaultResultStream(input())).rejects.toMatchObject({ code: "decision-rejected" });
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("已结束 SDK 根即使元数据仍开放也不能补写", async () => {
    sdkStatus = "completed";
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "decision-rejected", acknowledgement: "none" });
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it("观察过程中 SDK 根完成，发送前再次读取状态并拒绝操作", async () => {
    mocks.getInfo.mockImplementationOnce(async () => ({ done: false, tailIndex: -1 }))
      .mockImplementationOnce(async () => { sdkStatus = "completed"; return { done: false, tailIndex: -1 }; });
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "decision-rejected", acknowledgement: "none" });
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it.each(["failed", "cancelled", "pending", "unknown"])("SDK %s 状态不能冒充有效生产停止证据", async (status) => {
    sdkStatus = status;
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "observation-failed", acknowledgement: "none" });
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it("调用方仍有未决生产时拒绝写入与关闭，不根据运行状态推断已停", async () => {
    await expect(writeDefaultResultStreamFrame({ ...input(), producerSettled: false })).rejects.toMatchObject({ code: "decision-rejected" });
    frames = [frozen.frame];
    await expect(closeDefaultResultStream({ ...input(), producerSettled: false })).rejects.toMatchObject({ code: "decision-rejected" });
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it.each(["child", "other-run", "other-hash", "mutated-frame"])("拒绝 %s 冻结来源，SDK 尚未被调用", async (variant) => {
    if (variant === "child") owner.root = false;
    if (variant === "other-run") owner.runId = "00000000-0000-4000-8000-0000000000d2";
    if (variant === "other-hash") owner.frameHash = "0".repeat(64);
    if (variant === "mutated-frame") frozen.frame.result = { amount: 1 };
    await expect(observeDefaultResultStream(input())).rejects.toMatchObject({ code: "invalid-source" });
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "invalid-source" });
    await expect(closeDefaultResultStream(input())).rejects.toMatchObject({ code: "invalid-source" });
    expect(mocks.getRun).not.toHaveBeenCalled();
  });

  it("被动验证先于 Zod，不执行冻结包装上的访问器", async () => {
    const getter = vi.fn(() => frozen.frame);
    Object.defineProperty(frozen, "frame", { get: getter });
    await expect(observeDefaultResultStream(input())).rejects.toMatchObject({ code: "invalid-source" });
    expect(getter).not.toHaveBeenCalled();
  });

  it("公开 Run 标识不同或执行不存在时不操作其他运行", async () => {
    mocks.getRun.mockReturnValue({ runId: "wrun_other", exists: Promise.resolve(true) });
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "observation-failed" });
    mocks.getRun.mockReturnValue({ runId: SDK_ID, exists: Promise.resolve(false) });
    await expect(observeDefaultResultStream(input())).rejects.toMatchObject({ code: "observation-failed" });
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it("普通服务端调用公开接口，工作流正文的 SDK stub 错误明确拒绝且不改业务", async () => {
    await expect(writeDefaultResultStreamFrame(input())).resolves.toMatchObject({ matchedFrames: 1 });
    mocks.getRun.mockImplementation(() => { throw new Error("workflow context forbids getRun"); });
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "observation-failed", acknowledgement: "none" });
    expect(mocks.write).toHaveBeenCalledOnce();
  });
});

describe("可信有界读回", () => {
  it("SDK 元数据的无关额外属性不进入共享观察，仅合法尾部与关闭字段被投影", async () => {
    mocks.getInfo.mockResolvedValue({ done: false, tailIndex: -1, providerMetadata: "not shared" });
    const result = await observeDefaultResultStream(input());
    expect(result).toMatchObject({ metadata: { done: false, tailIndex: -1 }, readStatus: "verified_snapshot" });
    expect(Object.keys(result.metadata!)).toEqual(["done", "tailIndex"]);
  });

  it.each([null, { done: true }, { done: "false", tailIndex: -1 }, { done: false, tailIndex: -2 }])("未知或非法元数据不能当首次空流", async (metadata) => {
    mocks.getInfo.mockResolvedValue(metadata);
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "observation-failed", acknowledgement: "none" });
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it("首次流查询的 404 不能转换成空流并盲写", async () => {
    mocks.getInfo.mockRejectedValue(Object.assign(new Error("missing stream"), { status: 404 }));
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "observation-failed", acknowledgement: "none" });
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it("前后元数据变化不能获得完整快照", async () => {
    frames = [frozen.frame];
    mocks.getInfo.mockResolvedValueOnce({ done: false, tailIndex: 0 }).mockResolvedValueOnce({ done: false, tailIndex: 1 });
    await expect(observeDefaultResultStream(input())).resolves.toMatchObject({ readStatus: "partial" });
  });

  it("公开 Run 尾部与 World 默认流不同则拒绝核对", async () => {
    mocks.getTailIndex.mockResolvedValue(7);
    await expect(observeDefaultResultStream(input())).rejects.toMatchObject({ code: "observation-failed" });
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it("SDK EOF 不替代缺失或失败的 World 元数据", async () => {
    frames = [frozen.frame]; closed = true;
    mocks.getInfo.mockResolvedValueOnce({ done: true, tailIndex: 0 }).mockRejectedValueOnce(new Error("metadata unavailable"));
    await expect(observeDefaultResultStream(input())).rejects.toMatchObject({ code: "observation-failed" });
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.releaseReader).toHaveBeenCalledOnce();
  });

  it("提前 EOF 或冲突帧不成为完整快照", async () => {
    frames = [frozen.frame]; closed = true;
    mocks.read.mockResolvedValueOnce({ done: true, value: undefined });
    await expect(observeDefaultResultStream(input())).resolves.toMatchObject({ readStatus: "partial", matchedFrames: 0 });
    frames = [{ ...frozen.frame, result: { amount: 99 } }];
    await expect(observeDefaultResultStream(input())).resolves.toMatchObject({ readStatus: "partial", conflictingFrames: 1 });
    await expect(closeDefaultResultStream(input())).rejects.toMatchObject({ code: "decision-rejected" });
  });

  it("SDK 半帧解码异常仍取消读者并释放锁", async () => {
    frames = [frozen.frame];
    const error = new Error("incomplete frame");
    mocks.read.mockRejectedValue(error);
    await expect(observeDefaultResultStream(input())).rejects.toMatchObject({ code: "observation-failed", cause: error });
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.releaseReader).toHaveBeenCalledOnce();
  });

  it("最多读六十四帧，超限存储不能截断后宣称送达", async () => {
    frames = Array.from({ length: 64 }, () => frozen.frame);
    await expect(observeDefaultResultStream(input())).resolves.toMatchObject({ matchedFrames: 64, readStatus: "verified_snapshot" });
    expect(mocks.read).toHaveBeenCalledTimes(64);
    frames.push(frozen.frame); mocks.read.mockClear();
    await expect(observeDefaultResultStream(input())).resolves.toMatchObject({ readStatus: "partial", matchedFrames: 0 });
    expect(mocks.read).not.toHaveBeenCalled();
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "decision-rejected" });
  });

  it("读超时后仍发出取消并释放锁，不虚报已核对", async () => {
    vi.useFakeTimers(); frames = [frozen.frame];
    mocks.read.mockReturnValue(new Promise<never>(() => undefined));
    const result = observeDefaultResultStream(input());
    const assertion = expect(result).rejects.toMatchObject({ code: "observation-failed" });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.releaseReader).toHaveBeenCalledOnce();
  });

  it("先释放读锁失败后仍尝试取消，两者失败时保留最初释放错误", async () => {
    frames = [frozen.frame];
    const error = new Error("release failed");
    mocks.cancel.mockRejectedValue(new Error("cancel failed"));
    mocks.releaseReader.mockImplementation(() => { throw error; });
    await expect(observeDefaultResultStream(input())).rejects.toMatchObject({ code: "observation-failed", cause: error });
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.releaseReader).toHaveBeenCalledTimes(2);
  });

  it("读锁已释放后公开取消失败仍拒绝完整快照", async () => {
    frames = [frozen.frame];
    const error = new Error("readable cancel failed");
    mocks.cancel.mockRejectedValue(error);
    await expect(observeDefaultResultStream(input())).rejects.toMatchObject({ code: "observation-failed", cause: error });
    expect(mocks.releaseReader).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });

  it("读回自有操作失败不能在 reader 已释放后变成完整快照", async () => {
    const error = new Error("readback pipe failed");
    frames = [frozen.frame];
    mocks.getReadable.mockImplementation(({ ops }: { ops: Promise<unknown>[] }) => {
      const failed = Promise.reject(error); void failed.catch(() => undefined); ops.push(failed);
      readIndex = 0;
      return { getTailIndex: mocks.getTailIndex, cancel: mocks.cancel, getReader: () => ({ read: mocks.read, cancel: mocks.cancel, releaseLock: mocks.releaseReader }) };
    });
    await expect(observeDefaultResultStream(input())).rejects.toMatchObject({ code: "observation-failed", cause: error });
    expect(mocks.releaseReader).toHaveBeenCalledOnce();
  });

  it("完整读取先释放读锁并收敛公开 read ops，之后才取消开放流", async () => {
    vi.useFakeTimers(); frames = [frozen.frame]; const readAck = deferred();
    mocks.getReadable.mockImplementation(({ ops }: { ops: Promise<unknown>[] }) => {
      ops.push(readAck.promise); readIndex = 0;
      return { getTailIndex: mocks.getTailIndex, cancel: mocks.cancel, getReader: () => ({ read: mocks.read, cancel: mocks.cancel, releaseLock: mocks.releaseReader }) };
    });
    mocks.releaseReader.mockImplementation(() => { readAck.resolve(); });
    mocks.cancel.mockImplementation(async () => { expect(mocks.releaseReader).toHaveBeenCalledOnce(); });
    const result = observeDefaultResultStream(input());
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toMatchObject({ readStatus: "verified_snapshot", matchedFrames: 1 });
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
});

describe("独立发送操作的明确回执", () => {
  it("write 接受之后仍等待自己的迟到操作，不把接受或释放锁当 ACK", async () => {
    vi.useFakeTimers(); const ack = deferred();
    mocks.getWritable.mockImplementation(({ ops }: { ops: Promise<unknown>[] }) => {
      ops.push(ack.promise);
      return { getWriter: () => ({ write: mocks.write, releaseLock: mocks.releaseWriter }) };
    });
    let settled = false;
    const result = writeDefaultResultStreamFrame(input());
    void result.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.write).toHaveBeenCalledOnce(); expect(mocks.releaseWriter).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    ack.resolve();
    await expect(result).resolves.toMatchObject({ matchedFrames: 1, producerSettled: true });
  });

  it("一个 own op 拒绝时仍收敛其他 op，原拒绝不变成已停证明", async () => {
    vi.useFakeTimers(); const first = deferred(), second = deferred();
    mocks.getWritable.mockImplementation(({ ops }: { ops: Promise<unknown>[] }) => {
      ops.push(first.promise, second.promise);
      return { getWriter: () => ({ write: mocks.write, releaseLock: mocks.releaseWriter }) };
    });
    const error = new Error("append ACK lost");
    let settled = false;
    const result = writeDefaultResultStreamFrame(input());
    void result.then(() => { settled = true; }, () => { settled = true; });
    const assertion = expect(result).rejects.toMatchObject({ code: "acknowledgement-unknown", acknowledgement: "unknown", cause: error });
    await vi.advanceTimersByTimeAsync(0); first.reject(error);
    await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false);
    second.resolve(); await assertion;
    expect(mocks.getWritable).toHaveBeenCalledOnce();
  });

  it("写入已接受但 ACK 未到总时限就保留未知，不自动重试", async () => {
    vi.useFakeTimers(); const ack = deferred();
    mocks.getWritable.mockImplementation(({ ops }: { ops: Promise<unknown>[] }) => {
      ops.push(ack.promise);
      return { getWriter: () => ({ write: mocks.write, releaseLock: mocks.releaseWriter }) };
    });
    const result = writeDefaultResultStreamFrame(input());
    const assertion = expect(result).rejects.toMatchObject({ code: "acknowledgement-unknown", acknowledgement: "unknown" });
    await vi.advanceTimersByTimeAsync(101); await assertion;
    expect(mocks.getWritable).toHaveBeenCalledOnce(); expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.getReadable).toHaveBeenCalledOnce();
    ack.resolve();
  });

  it("操作与释放锁同时失败时保留最初操作错误", async () => {
    const error = new Error("write outcome unknown");
    mocks.write.mockRejectedValue(error);
    mocks.abort.mockRejectedValue(new Error("abort failed"));
    mocks.releaseWriter.mockImplementation(() => { throw new Error("release failed"); });
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "acknowledgement-unknown", cause: error });
    expect(mocks.releaseWriter).toHaveBeenCalledOnce();
    expect(mocks.abort).toHaveBeenCalledOnce();
  });

  it("没有自有 SDK 操作边界不能把普通 writer 接受伪装成持久 ACK", async () => {
    mocks.getWritable.mockReturnValue({ getWriter: () => ({ write: mocks.write, releaseLock: mocks.releaseWriter }) });
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "acknowledgement-unknown", acknowledgement: "unknown" });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("明确关闭 ACK 丢失不重关，也不声称已确认送达", async () => {
    frames = [frozen.frame];
    const error = new Error("close ACK lost");
    mocks.close.mockImplementation(async () => { closed = true; throw error; });
    await expect(closeDefaultResultStream(input())).rejects.toMatchObject({ code: "acknowledgement-unknown", acknowledgement: "unknown" });
    expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.releaseWriter).toHaveBeenCalledOnce();
  });

  it("明确发送 ACK 后读回故障与未知 ACK 分开，保留已确认字段供持久记录", async () => {
    mocks.write.mockImplementation(async (frame: unknown) => { frames.push(frame); mocks.getInfo.mockRejectedValue(new Error("readback unavailable")); });
    await expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "acknowledged-unverified", acknowledgement: "confirmed" });
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("总时限不因开始写入而重置", async () => {
    vi.useFakeTimers();
    mocks.getInfo.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({ done: false, tailIndex: -1 }), 60)));
    mocks.getWritable.mockImplementation(({ ops }: { ops: Promise<unknown>[] }) => {
      ops.push(new Promise<void>((resolve) => setTimeout(resolve, 60)));
      return { getWriter: () => ({ write: mocks.write, releaseLock: mocks.releaseWriter }) };
    });
    const assertion = expect(writeDefaultResultStreamFrame(input())).rejects.toMatchObject({ code: "acknowledgement-unknown" });
    await vi.advanceTimersByTimeAsync(101); await assertion;
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it.each([0, -1, 60_001, 1.5])("拒绝非法总时限 %s", async (timeoutMs) => {
    await expect(observeDefaultResultStream({ ...input(), timeoutMs })).rejects.toBeInstanceOf(DefaultResultStreamSdkError);
    expect(mocks.getRun).not.toHaveBeenCalled();
  });
});
