import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));

import { createScheduleAction } from "@/server/actions/create-schedule";
import { updateScheduleStatusAction } from "@/server/actions/update-schedule-status";

const AGENT_ID = "00000000-0000-4000-8000-000000000201";
const SCHEDULE_ID = "00000000-0000-4000-8000-000000000202";

describe("定时任务操作异常日志", () => {
  beforeEach(() => {
    mocks.select.mockReset().mockImplementation(() => {
      const error = new Error("连接失败 authorization: Bearer private-schedule-token");
      error.name = "PostgresError";
      throw error;
    });
  });

  it("创建失败时只记录脱敏后的数据库错误", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await createScheduleAction({
      agentId: AGENT_ID,
      spec: { kind: "interval", minutes: 5 },
      input: {},
    });

    expect(result).toEqual({ ok: false, error: "创建定时任务失败，请稍后重试" });
    expect(JSON.stringify(log.mock.calls)).toContain("数据库操作失败");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-schedule-token");
    log.mockRestore();
  });

  it("更新状态失败时只记录脱敏后的数据库错误", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await updateScheduleStatusAction(SCHEDULE_ID, "paused");

    expect(result).toEqual({ ok: false, error: "更新定时任务状态失败，请稍后重试" });
    expect(JSON.stringify(log.mock.calls)).toContain("数据库操作失败");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-schedule-token");
    log.mockRestore();
  });
});
