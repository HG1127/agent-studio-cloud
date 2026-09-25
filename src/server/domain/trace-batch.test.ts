import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTraceSinceBatch } from "./trace-batch";

const valid = {
  id: "00000000-0000-4000-8000-000000000001",
  seq: 12,
  nodeId: null,
  kind: "run.started",
  level: "info" as const,
  title: "开始运行",
  detail: null,
  at: new Date("2026-09-25T08:00:00.000Z"),
};

describe("parseTraceSinceBatch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("隔离坏记录时仍把游标推进到已扫描的最高序号", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const batch = parseTraceSinceBatch([
      { ...valid, id: "bad-id", seq: 11 },
      valid,
      { ...valid, id: "also-bad", seq: 13 },
    ], 10);
    expect(batch.events).toEqual([expect.objectContaining({ seq: 12, title: "开始运行" })]);
    expect(batch.nextCursor).toBe(13);
    expect(batch.scannedCount).toBe(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2 条"));
  });

  it("空批次保持现有游标", () => {
    expect(parseTraceSinceBatch([], 27)).toEqual({ events: [], nextCursor: 27, scannedCount: 0 });
  });
});
