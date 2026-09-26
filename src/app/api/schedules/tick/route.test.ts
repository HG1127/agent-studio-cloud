import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimed: [] as Array<Record<string, unknown>>,
  startRunCore: vi.fn(),
  updateSet: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updateSet(values);
        return {
          where: () => ({ returning: async () => mocks.claimed }),
        };
      },
    }),
  },
}));

vi.mock("@/server/services/start-run-core", () => ({ startRunCore: mocks.startRunCore }));

import { POST } from "./route";

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
  mocks.claimed = [];
  mocks.startRunCore.mockReset().mockResolvedValue({ ok: true, runId: "00000000-0000-4000-8000-000000000104" });
  mocks.updateSet.mockReset();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("定时触发入口", () => {
  it("拒绝无效密钥且不访问数据库", async () => {
    const response = await POST(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "未授权的调用" });
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.startRunCore).not.toHaveBeenCalled();
  });

  it("始终使用定时任务创建时冻结的版本", async () => {
    const dueAt = new Date("2026-09-26T00:00:00.000Z");
    mocks.claimed = [{
      id: SCHEDULE_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      spec: { kind: "interval", minutes: 5 },
      input: { ticket: "T-100" },
      nextRunAt: dueAt,
      consecutiveFailures: 0,
      status: "active",
    }];

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, claimed: 1, started: 1, failed: 0 });
    expect(mocks.startRunCore).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      input: { ticket: "T-100" },
      sourceType: "schedule",
      sourceKey: `${SCHEDULE_ID}:${dueAt.toISOString()}`,
    });
  });
});
