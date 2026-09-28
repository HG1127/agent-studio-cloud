import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  due: [] as Array<{ id: string }>,
  claimed: [] as Array<Record<string, unknown>>,
  startRunCore: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
  limit: vi.fn(),
  updateSet: vi.fn(),
  rejectAdvance: false,
}));

vi.mock("@/lib/db", () => ({
  db: (() => {
    const client = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: (value: number) => {
                mocks.limit(value);
                return {
                  for: async (...args: unknown[]) => {
                    mocks.lock(...args);
                    return mocks.due;
                  },
                };
              },
            }),
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          mocks.updateSet(values);
          return {
            where: () => ({ returning: async () => mocks.rejectAdvance && mocks.updateSet.mock.calls.length === 2 ? [] : mocks.claimed }),
          };
        },
      }),
    };
    return {
      ...client,
      transaction: async (run: (tx: typeof client) => unknown) => {
        mocks.transaction();
        return run(client);
      },
    };
  })(),
}));

vi.mock("@/server/services/start-run-core", () => ({ startRunCore: mocks.startRunCore }));

import { MAX_SCHEDULES_PER_TICK, POST } from "./route";

const SCHEDULE_ID = "00000000-0000-4000-8000-000000000101";
const AGENT_ID = "00000000-0000-4000-8000-000000000102";
const VERSION_ID = "00000000-0000-4000-8000-000000000103";

function request(secret = "test-cron-secret") {
  return new Request("http://localhost/api/schedules/tick", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  mocks.due = [];
  mocks.claimed = [];
  mocks.startRunCore.mockReset().mockResolvedValue({ ok: true, runId: "00000000-0000-4000-8000-000000000104" });
  mocks.transaction.mockReset();
  mocks.lock.mockReset();
  mocks.limit.mockReset();
  mocks.updateSet.mockReset();
  mocks.rejectAdvance = false;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("定时触发入口", () => {
  it("拒绝无效密钥且不访问数据库", async () => {
    const response = await POST(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "未授权的调用" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.startRunCore).not.toHaveBeenCalled();
  });

  it("始终使用定时任务创建时冻结的版本", async () => {
    const dueAt = new Date("2026-09-26T00:00:00.000Z");
    mocks.due = [{ id: SCHEDULE_ID }];
    mocks.claimed = [{
      id: SCHEDULE_ID,
      workspaceId: "00000000-0000-4000-8000-000000000001",
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      spec: { kind: "interval", minutes: 5 },
      input: { ticket: "T-100" },
      nextRunAt: dueAt,
      leaseUntil: new Date("2026-09-26T00:01:00.000Z"),
      consecutiveFailures: 0,
      status: "active",
    }];

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, claimed: 1, started: 1, failed: 0 });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.limit).toHaveBeenCalledWith(MAX_SCHEDULES_PER_TICK);
    expect(mocks.lock).toHaveBeenCalledWith("update", { skipLocked: true });
    expect(mocks.startRunCore).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      input: { ticket: "T-100" },
      sourceType: "schedule",
      sourceKey: `${SCHEDULE_ID}:${dueAt.toISOString()}`,
    });
  });

  it("入口晚到时跳过旧时间槽，仍用本次到期时间作为幂等键", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-26T00:17:00.000Z"));
      const dueAt = new Date("2026-09-26T00:00:00.000Z");
      mocks.due = [{ id: SCHEDULE_ID }];
      mocks.claimed = [{
        id: SCHEDULE_ID,
        workspaceId: "00000000-0000-4000-8000-000000000001",
        agentId: AGENT_ID,
        versionId: VERSION_ID,
        spec: { kind: "interval", minutes: 5 },
        input: {},
        nextRunAt: dueAt,
        leaseUntil: new Date("2026-09-26T00:18:00.000Z"),
        consecutiveFailures: 0,
        status: "active",
      }];

      const response = await POST(request());

      expect(response.status).toBe(200);
      expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
        nextRunAt: new Date("2026-09-26T00:20:00.000Z"),
      }));
      expect(mocks.startRunCore).toHaveBeenCalledWith(expect.objectContaining({
        sourceKey: `${SCHEDULE_ID}:${dueAt.toISOString()}`,
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("领取后任务被暂停时不再启动运行", async () => {
    mocks.due = [{ id: SCHEDULE_ID }];
    mocks.claimed = [{
      id: SCHEDULE_ID,
      workspaceId: "00000000-0000-4000-8000-000000000001",
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      spec: { kind: "interval", minutes: 5 },
      input: {},
      nextRunAt: new Date("2026-09-26T00:00:00.000Z"),
      leaseUntil: new Date("2026-09-26T00:01:00.000Z"),
      consecutiveFailures: 0,
      status: "active",
    }];
    mocks.rejectAdvance = true;

    const response = await POST(request());

    expect(await response.json()).toEqual({ ok: true, claimed: 1, started: 0, failed: 0 });
    expect(mocks.startRunCore).not.toHaveBeenCalled();
    expect(mocks.updateSet).toHaveBeenCalledTimes(2);
  });
});
