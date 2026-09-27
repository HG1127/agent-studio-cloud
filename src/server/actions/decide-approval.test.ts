import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  resumeHook: vi.fn(),
  revalidatePath: vi.fn(),
  updates: 0,
  returningRows: [] as unknown[][],
  transactions: 0,
}));

vi.mock("@/lib/db", () => ({
  db: (() => {
    const client = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.rows.shift() ?? [],
          for: () => ({ limit: async () => mocks.rows.shift() ?? [] }),
        }),
      }),
    }),
    update: () => {
      mocks.updates += 1;
      return { set: () => ({ where: () => ({ returning: async () => mocks.returningRows.shift() ?? [] }) }) };
    },
    };
    return {
      ...client,
      transaction: async (run: (tx: typeof client) => unknown) => {
        mocks.transactions += 1;
        return run(client);
      },
    };
  })(),
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
  mocks.returningRows = [];
  mocks.transactions = 0;
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

  it("继续已保存的确认后缓存刷新失败仍返回成功", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rows = [
      [{ id: APPROVAL_ID, status: "approved", note: null }],
      [{ agentId: AGENT_ID, status: "waiting_approval" }],
    ];
    mocks.revalidatePath.mockImplementationOnce(() => { throw new Error("缓存暂时不可用"); });

    await expect(decideApprovalAction(RUN_ID, APPROVAL_ID, {
      decision: "approved", resumeOnly: true,
    })).resolves.toEqual({ ok: true });

    expect(mocks.resumeHook).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      `/runs/${RUN_ID}`, "/runs", "/", `/agents/${AGENT_ID}`, "/agents",
    ]);
  });

  it("旧页面重复提交相同决定时直接继续已保存的确认", async () => {
    mocks.rows = [
      [{ id: APPROVAL_ID, status: "approved", note: "同意执行" }],
      [{ agentId: AGENT_ID, status: "waiting_approval" }],
    ];

    const result = await decideApprovalAction(RUN_ID, APPROVAL_ID, {
      decision: "approved",
      note: "旧页面里的备注",
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

  it("继续历史确认时不会把备注中的服务凭据再次送入工作流", async () => {
    mocks.rows = [
      [{ id: APPROVAL_ID, status: "approved", note: "同意，authorization: Bearer private-approval-token" }],
      [{ agentId: AGENT_ID, status: "waiting_approval" }],
    ];

    const result = await decideApprovalAction(RUN_ID, APPROVAL_ID, {
      decision: "approved",
      resumeOnly: true,
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.resumeHook).toHaveBeenCalledWith(`approval:${APPROVAL_ID}`, {
      decision: "approved",
      note: "同意，[已隐藏敏感信息]",
    });
  });

  it("新确认在保存和恢复前隐藏备注中的服务凭据", async () => {
    mocks.rows = [
      [{ id: APPROVAL_ID, status: "pending", note: null }],
      [{ agentId: AGENT_ID, status: "waiting_approval" }],
      [{ status: "waiting_approval" }],
    ];
    mocks.returningRows = [[{ id: APPROVAL_ID }]];

    const result = await decideApprovalAction(RUN_ID, APPROVAL_ID, {
      decision: "approved",
      note: "同意，secret=private-approval-value",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.resumeHook).toHaveBeenCalledWith(`approval:${APPROVAL_ID}`, {
      decision: "approved",
      note: "同意，[已隐藏敏感信息]",
    });
  });

  it("新确认已保存并恢复后缓存刷新失败不误报确认失败", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rows = [
      [{ id: APPROVAL_ID, status: "pending", note: null }],
      [{ agentId: AGENT_ID, status: "waiting_approval" }],
      [{ status: "waiting_approval" }],
    ];
    mocks.returningRows = [[{ id: APPROVAL_ID }]];
    mocks.revalidatePath.mockImplementationOnce(() => { throw new Error("缓存暂时不可用"); });

    await expect(decideApprovalAction(RUN_ID, APPROVAL_ID, { decision: "approved" }))
      .resolves.toEqual({ ok: true });
    expect(mocks.updates).toBe(1);
    expect(mocks.resumeHook).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      `/runs/${RUN_ID}`, "/runs", "/", `/agents/${AGENT_ID}`, "/agents",
    ]);
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

    expect(result).toEqual({
      ok: false,
      error: "确认已保留，但运行暂时无法继续，请稍后重试",
      saved: true,
    });
    expect(mocks.updates).toBe(0);
  });

  it("写入确认前重新锁定运行，取消已先完成时不再改写确认", async () => {
    mocks.rows = [
      [{ id: APPROVAL_ID, status: "pending", note: null }],
      [{ agentId: AGENT_ID, status: "waiting_approval" }],
      [{ status: "cancelled" }],
    ];

    const result = await decideApprovalAction(RUN_ID, APPROVAL_ID, { decision: "approved" });

    expect(result).toEqual({ ok: false, error: "这次运行已不再等待确认，请刷新页面查看最新状态" });
    expect(mocks.transactions).toBe(1);
    expect(mocks.updates).toBe(0);
    expect(mocks.resumeHook).not.toHaveBeenCalled();
  });

  it("恢复结果不确定时保留新决定并交给页面继续恢复", async () => {
    mocks.rows = [
      [{ id: APPROVAL_ID, status: "pending", note: null }],
      [{ agentId: AGENT_ID, status: "waiting_approval" }],
      [{ status: "waiting_approval" }],
    ];
    mocks.returningRows = [[{ id: APPROVAL_ID }]];
    mocks.resumeHook.mockRejectedValue(new Error("workflow response lost"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await decideApprovalAction(RUN_ID, APPROVAL_ID, { decision: "approved", note: "同意" });

    expect(result).toEqual({
      ok: false,
      error: "确认已保留，但运行暂时无法继续，请稍后重试",
      saved: true,
    });
    expect(mocks.updates).toBe(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/runs/${RUN_ID}`);
  });
});
