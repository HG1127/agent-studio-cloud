import { describe, expect, it, vi } from "vitest";
import { writeTraceStreamBestEffort } from "./trace-stream";

describe("运行轨迹观测流", () => {
  it("写入成功时返回成功", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    await expect(writeTraceStreamBestEffort(write)).resolves.toBe(true);
    expect(write).toHaveBeenCalledOnce();
  });

  it("观测流异常时记录错误但不向业务步骤抛出", async () => {
    const error = new Error("stream unavailable");
    const onError = vi.fn();
    await expect(writeTraceStreamBestEffort(async () => { throw error; }, onError)).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
