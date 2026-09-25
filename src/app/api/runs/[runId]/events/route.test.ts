import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batches: [] as Array<{ events: unknown[]; nextCursor: number; scannedCount: number }>,
  getRunRow: vi.fn(async () => ({ id: "00000000-0000-4000-8000-0000000000f6", status: "completed" })),
  hasRunTraceKind: vi.fn(async () => false),
  listTraceSince: vi.fn(async () => mocks.batches.shift() ?? { events: [], nextCursor: 1, scannedCount: 0 }),
}));

vi.mock("@/server/queries/runs", () => ({ getRunRow: mocks.getRunRow }));
vi.mock("@/server/queries/trace", () => ({
  hasRunTraceKind: mocks.hasRunTraceKind,
  listTraceSince: mocks.listTraceSince,
}));

import { GET } from "@/app/api/runs/[runId]/events/route";

const RUN_ID = "00000000-0000-4000-8000-0000000000f6";
const terminalEvent = {
  id: "00000000-0000-4000-8000-0000000000f7",
  seq: 1,
  nodeId: null,
  kind: "run.completed",
  level: "info",
  title: "流程执行完成",
  detail: null,
  at: "2026-09-26T00:00:00.000Z",
};

describe("运行轨迹流终态收尾", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.batches.length = 0;
    mocks.getRunRow.mockResolvedValue({ id: RUN_ID, status: "completed" });
    mocks.hasRunTraceKind.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("终态状态先提交时等待匹配轨迹送达后再关流", async () => {
    mocks.batches.push(
      { events: [], nextCursor: 0, scannedCount: 0 },
      { events: [terminalEvent], nextCursor: 1, scannedCount: 1 },
      { events: [], nextCursor: 1, scannedCount: 0 },
    );
    const response = await GET(new Request(`http://localhost/api/runs/${RUN_ID}/events`), {
      params: Promise.resolve({ runId: RUN_ID }),
    });
    const bodyPromise = response.text();

    await vi.advanceTimersByTimeAsync(5_000);
    const body = await bodyPromise;

    expect(body.indexOf("event: trace")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("event: done")).toBeGreaterThan(body.indexOf("event: trace"));
    expect(body).toContain('"kind":"run.completed"');
  });

  it("终态轨迹持续缺失时在宽限期后仍会关闭连接", async () => {
    const response = await GET(new Request(`http://localhost/api/runs/${RUN_ID}/events`), {
      params: Promise.resolve({ runId: RUN_ID }),
    });
    const bodyPromise = response.text();

    await vi.advanceTimersByTimeAsync(20_000);
    const body = await bodyPromise;

    expect(body).not.toContain("event: trace");
    expect(body).toContain("event: done");
    expect(body).toContain('"status":"completed"');
  });
});
