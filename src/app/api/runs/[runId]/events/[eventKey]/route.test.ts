import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findReceipt: vi.fn(),
  matchesReceipt: vi.fn(),
  outcome: vi.fn(),
  markAccepted: vi.fn(),
  resumeHook: vi.fn(),
  status: "completed",
}));

vi.mock("workflow/api", () => ({ resumeHook: mocks.resumeHook }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ status: mocks.status }] }) }) }) },
}));
vi.mock("@/server/services/wait-event-submission", () => ({
  findWaitEventSubmission: mocks.findReceipt,
  waitEventSubmissionMatches: mocks.matchesReceipt,
  waitEventOutcome: mocks.outcome,
  markWaitEventSubmissionAccepted: mocks.markAccepted,
  claimWaitEventSubmission: vi.fn(),
}));
vi.mock("@/server/queries/runs", () => ({ getPendingWait: vi.fn(), getPendingWaitHook: vi.fn() }));

import { POST } from "./route";

const RUN_ID = "00000000-0000-4000-8000-0000000000e1";
const EVENT_KEY = "customer.profile.updated";

function request() {
  return new Request(`http://localhost/api/runs/${RUN_ID}/events/${EVENT_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-wait-event-token": "submission-token" },
    body: JSON.stringify({ customerId: "C-100" }),
  });
}

function context() {
  return { params: Promise.resolve({ runId: RUN_ID, eventKey: EVENT_KEY }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = "completed";
  mocks.findReceipt.mockResolvedValue({
    id: "00000000-0000-4000-8000-0000000000e2",
    runId: RUN_ID,
    eventKey: EVENT_KEY,
    status: "processing",
    hookToken: "hook-token",
    attemptToken: "00000000-0000-4000-8000-0000000000e3",
  });
  mocks.matchesReceipt.mockReturnValue(true);
  mocks.outcome.mockResolvedValue(null);
  mocks.markAccepted.mockResolvedValue(undefined);
});

describe("等待消息回执的终态确认", () => {
  it("运行已完成但缺少恢复轨迹时不能误回成功", async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(mocks.markAccepted).not.toHaveBeenCalled();
    expect(mocks.resumeHook).not.toHaveBeenCalled();
  });

  it("该次等待超时后明确拒绝迟到消息", async () => {
    mocks.outcome.mockResolvedValue("timed_out");

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "等待已超时，消息未被接收" });
    expect(mocks.markAccepted).not.toHaveBeenCalled();
  });

  it("仅当该次等待留下恢复轨迹时确认成功", async () => {
    mocks.outcome.mockResolvedValue("resumed");

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.markAccepted).toHaveBeenCalledOnce();
  });
});
