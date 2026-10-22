import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ writable: vi.fn(), metadata: vi.fn() }));
vi.mock("workflow", () => ({ getWorkflowMetadata: mocks.metadata }));
vi.mock("workflow/api", () => ({ getRun: () => ({ getWritable: mocks.writable }) }));
import { writeTraceStreamWithOwnOperations } from "./trace-stream-sdk";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.metadata.mockReturnValue({ workflowRunId: "wrun_trace" });
});
describe("日志流只等待自己的 SDK5 操作", () => {
  it("持续写入后释放锁且不关闭命名空间", async () => {
    const values: string[] = [];
    const stream = new WritableStream<string>({ write: (value) => { values.push(value); } });
    mocks.writable.mockReturnValue(stream);
    await writeTraceStreamWithOwnOperations("一");
    await writeTraceStreamWithOwnOperations("二");
    expect(values).toEqual(["一", "二"]);
    expect(stream.locked).toBe(false);
    expect(mocks.writable).toHaveBeenCalledWith({ namespace: "trace", ops: expect.any(Array) });
  });
  it("write返回不代表flush确认，全部own ops结束才返回", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    const release = vi.fn();
    mocks.writable.mockImplementation(({ ops }: { ops: Promise<unknown>[] }) => ({
      getWriter: () => ({ write: async () => { ops.push(pending); }, releaseLock: release }),
    }));
    let settled = false;
    const write = writeTraceStreamWithOwnOperations("日志").then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(release).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    resolve();
    await write;
    expect(settled).toBe(true);
  });
  it("own ops拒绝不留到外层业务step，且释放writer", async () => {
    const failure = new Error("日志保存失败");
    const release = vi.fn();
    mocks.writable.mockImplementation(({ ops }: { ops: Promise<unknown>[] }) => ({
      getWriter: () => ({ write: async () => { ops.push(Promise.reject(failure)); }, releaseLock: release }),
    }));
    await expect(writeTraceStreamWithOwnOperations("日志")).rejects.toBe(failure);
    expect(release).toHaveBeenCalledOnce();
  });
  it("write本身失败仍等待own ops并保留原错误", async () => {
    const writeFailure = new Error("write失败");
    const release = vi.fn();
    mocks.writable.mockImplementation(({ ops }: { ops: Promise<unknown>[] }) => ({
      getWriter: () => ({ write: async () => { ops.push(Promise.reject(new Error("flush失败"))); throw writeFailure; }, releaseLock: release }),
    }));
    await expect(writeTraceStreamWithOwnOperations("日志")).rejects.toBe(writeFailure);
    expect(release).toHaveBeenCalledOnce();
  });
});
