import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  resumeHook: vi.fn(),
  revalidatePath: vi.fn(),
  updates: 0,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.rows.shift() ?? [] }),
      }),
    }),
    update: () => {
      mocks.updates += 1;
      return { set: () => ({ where: () => ({ returning: async () => [] }) }) };
    },
  },
}));
vi.mock("workflow/api", () => ({ resumeHook: mocks.resumeHook }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { decideApprovalAction } from "@/server/actions/decide-approval";

const RUN_ID = "00000000-0000-4000-8000-0000000000e5";
const APPROVAL_ID = "00000000-0000-4000-8000-0000000000e6";
const AGENT_ID = "00000000-0000-4000-8000-0000000000e7";

beforeEach(() => {
  mocks.rows = [];
  mocks.resumeHook.mockReset().mockResolvedValue(undefined);
  mocks.revalidatePath.mockReset();
  mocks.updates = 0;
});

afterEach(() => vi.restoreAllMocks());

describe("已记录确认的运行恢复", () => {
  it("按数据库中已经保存的决定恢复且不再次改写确认记录", async () => {
    mocks.rows = [
      [{ id: APPROVAL_ID, status: "approved", note: "同意执行" }],
      [{ agentId: AGENT_ID, status: "waiting_approval" }],
    ];

    const result = await decideApprovalAction(RUN_ID, APPROVAL_ID, {
      decision: "approved",
      resumeOnly: true,
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.resumeHook).toHaveBeenCalledWith(`approval:${APPROVAL_ID}`, {
      decision: "approved",
      note: "同意执行",
    });
    expect(mocks.updates).toBe(0);
  });

  it("拒绝用继续请求改变已经保存的决定", async () => {
    mocks.rows = [
      [{ id: APPROVAL_ID, status: "approved", note: null }],
      [{ agentId: AGENT_ID, status: "waiting_approval" }],
    ];

    const result = await decideApprovalAction(RUN_ID, APPROVAL_ID, {
      decision: "rejected",
      resumeOnly: true,
    });

    expect(result).toEqual({ ok: false, error: "确认记录与继续请求不一致，请刷新页面后重试" });
    expect(mocks.resumeHook).not.toHaveBeenCalled();
    expect(mocks.updates).toBe(0);
  });

  it("恢复失败时保留原决定供稍后重试", async () => {
    mocks.rows = [
      [{ id: APPROVAL_ID, status: "rejected", note: "信息不完整" }],
      [{ agentId: AGENT_ID, status: "waiting_approval" }],
    ];
    mocks.resumeHook.mockRejectedValue(new Error("workflow unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await decideApprovalAction(RUN_ID, APPROVAL_ID, {
      decision: "rejected",
      resumeOnly: true,
    });

    expect(result).toEqual({ ok: false, error: "确认已保留，但运行暂时无法继续，请稍后重试" });
    expect(mocks.updates).toBe(0);
  });
});
