import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[][], resume: vi.fn(), cache: vi.fn(), updates: 0, transactions: 0, lostCommit: false, selectError: false }));
vi.mock("workflow/api", () => ({ resumeHook: mocks.resume }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.cache }));
vi.mock("@/lib/db", () => ({ db: (() => {
  const client = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => { if (mocks.selectError) throw new Error("private-database-value"); return mocks.rows.shift() ?? []; }, for: () => ({ limit: async () => mocks.rows.shift() ?? [] }) }) }) }),
    update: () => ({ set: () => { mocks.updates++; return { where: () => ({ returning: async () => [{ id: ID }] }) }; } }),
  };
  return { ...client, transaction: async (run: (tx: typeof client) => unknown) => { mocks.transactions++; const result = await run(client); if (mocks.lostCommit) throw new Error("commit response lost"); return result; } };
})() }));
import { decideRunApprovalAction } from "./decide-run-approval";
const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const input = { runId: RUN, approvalId: ID, confirmed: true as const, decision: "approved" as const, note: "已核对" };
const pending = { id: ID, status: "pending", note: null, payload: { review: null } };
const saved = { id: ID, status: "approved", note: "已核对" };
const waiting = { agentId: ID, status: "waiting_approval" };
beforeEach(() => { mocks.rows = []; mocks.resume.mockReset().mockResolvedValue(undefined); mocks.cache.mockReset(); mocks.updates = mocks.transactions = 0; mocks.lostCommit = mocks.selectError = false; vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());
describe("程序化审批完整请求核对与提交丢失恢复", () => {
  it("原子保存后按原决定恢复，返回接收确认而非任务完成", async () => {
    mocks.rows = [[pending], [waiting], [{ status: "waiting_approval" }], [saved], [waiting], []];
    expect(await decideRunApprovalAction(input)).toEqual({ ok: true, runId: RUN, approvalId: ID, decision: "approved", recorded: true });
    expect(mocks.updates).toBe(1);
    expect(mocks.resume).toHaveBeenCalledExactlyOnceWith(`approval:${ID}`, { decision: "approved", note: "已核对" });
  });
  it("事务已提交但回执丢失时核对同一决定及备注再恢复", async () => {
    mocks.lostCommit = true;
    mocks.rows = [[pending], [waiting], [{ status: "waiting_approval" }], [saved], [waiting], []];
    expect((await decideRunApprovalAction(input)).ok).toBe(true);
    expect(mocks.updates).toBe(1);
    expect(mocks.resume).toHaveBeenCalledOnce();
  });
  it.each(["completed", "waiting_approval"])("已消费的决定在 %s 状态找回，不再操作旧 Hook", async (status) => {
    mocks.rows = [[saved], [{ ...waiting, status }], [saved], [{ ...waiting, status }], [{ id: ID }]];
    expect((await decideRunApprovalAction(input)).ok).toBe(true);
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.updates).toBe(0);
  });
  it.each([{ ...input, note: "改变备注" }, { ...input, note: undefined }, { ...input, decision: "rejected" as const }])("改变决定或备注不恢复 %j", async (body) => {
    mocks.rows = [[saved], [waiting], [saved], [waiting], []];
    expect(await decideRunApprovalAction(body)).toMatchObject({ ok: false, error: "确认决定或备注已改变，请沿用原请求核对" });
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.updates).toBe(0);
  });
  it("事务回执丢失但另一备注获胜，不错误恢复别人的提交", async () => {
    mocks.lostCommit = true;
    mocks.rows = [[pending], [waiting], [{ status: "waiting_approval" }], [{ ...saved, note: "另一条备注" }], [waiting], []];
    expect((await decideRunApprovalAction(input)).ok).toBe(false);
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("恢复响应丢失但消费轨迹已出现，返回原决定成功", async () => {
    mocks.rows = [[saved], [waiting], [saved], [waiting], [], [saved], [waiting], [{ id: ID }]];
    mocks.resume.mockRejectedValue(new Error("response lost"));
    expect((await decideRunApprovalAction(input)).ok).toBe(true);
    expect(mocks.resume).toHaveBeenCalledOnce();
  });
  it("恢复尚未确认时返回已保存且可重试，不回滚决定", async () => {
    mocks.rows = [[saved], [waiting], [saved], [waiting], [], [saved], [waiting], []];
    mocks.resume.mockRejectedValue(new Error("response lost"));
    expect(await decideRunApprovalAction(input)).toMatchObject({ ok: false, saved: true, retryable: true });
    expect(mocks.updates).toBe(0);
  });
  it("取消后的未消费决定不再恢复", async () => {
    mocks.rows = [[saved], [{ ...waiting, status: "cancelled" }], [saved], [{ ...waiting, status: "cancelled" }], []];
    expect((await decideRunApprovalAction(input)).ok).toBe(false);
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("坏审批快照在保存前拒绝，不盲目批准", async () => {
    mocks.rows = [[{ ...pending, payload: { review: { format: "json", content: "not-json" } } }], [waiting]];
    expect((await decideRunApprovalAction(input)).ok).toBe(false);
    expect(mocks.updates).toBe(0);
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("数据库暂不可用返回重试且不泄露内部错误", async () => {
    mocks.selectError = true;
    expect(await decideRunApprovalAction(input)).toEqual({ ok: false, error: "提交确认失败，请稍后重试", retryable: true });
  });
  it("缓存刷新失败不把已保存并恢复的决定伪报失败", async () => {
    mocks.rows = [[saved], [waiting], [saved], [waiting], []];
    mocks.cache.mockImplementationOnce(() => { throw new Error("cache unavailable"); });
    expect((await decideRunApprovalAction(input)).ok).toBe(true);
  });
  it("不明确确认及额外字段无法进入数据库", async () => {
    expect((await decideRunApprovalAction({ ...input, confirmed: false } as unknown as typeof input)).ok).toBe(false);
    expect(mocks.transactions).toBe(0);
    expect(mocks.resume).not.toHaveBeenCalled();
  });
});
