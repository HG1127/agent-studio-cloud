import { describe, expect, it } from "vitest";
import { MAX_SCHEDULE_INTERVAL_MINUTES, ScheduleActionResult, ScheduleAgentOption, ScheduleCreateSpec, ScheduleSpec, ScheduleView } from "@/contracts/schedule";

const ID = "00000000-0000-4000-8000-000000000301";

describe("定时任务前后端共享契约", () => {
  it("间隔时间不能大到使触发日期无效", () => {
    expect(ScheduleCreateSpec.safeParse({ kind: "interval", minutes: MAX_SCHEDULE_INTERVAL_MINUTES }).success).toBe(true);
    expect(ScheduleCreateSpec.safeParse({ kind: "interval", minutes: MAX_SCHEDULE_INTERVAL_MINUTES + 1 }).success).toBe(false);
    expect(ScheduleCreateSpec.safeParse({ kind: "interval", minutes: Number.MAX_SAFE_INTEGER }).success).toBe(false);
    expect(ScheduleSpec.safeParse({ kind: "interval", minutes: MAX_SCHEDULE_INTERVAL_MINUTES + 1 }).success).toBe(true);
  });

  it("只接受可识别的助手选项", () => {
    expect(ScheduleAgentOption.safeParse({ id: ID, name: "客服助手" }).success).toBe(true);
    expect(ScheduleAgentOption.safeParse({ id: "not-a-uuid", name: "客服助手" }).success).toBe(false);
    expect(ScheduleAgentOption.safeParse({ id: ID, name: "" }).success).toBe(false);
  });

  it("拒绝数据库中的未知定时状态", () => {
    const base = {
      id: ID,
      agentId: "00000000-0000-4000-8000-000000000302",
      agentName: "客服助手",
      spec: { kind: "interval", minutes: 5 },
      nextRunAt: "2026-09-26T10:00:00.000Z",
      lastError: null,
      consecutiveFailures: 0,
      createdAt: "2026-09-26T09:00:00.000Z",
    };

    expect(ScheduleView.safeParse({ ...base, status: "active" }).success).toBe(true);
    expect(ScheduleView.safeParse({ ...base, status: "unknown" }).success).toBe(false);
    expect(ScheduleView.safeParse({ ...base, status: "error", spec: { kind: "interval", minutes: MAX_SCHEDULE_INTERVAL_MINUTES + 1 } }).success).toBe(true);
  });

  it("统一创建与状态更新动作的返回结构", () => {
    expect(ScheduleActionResult.safeParse({ ok: true }).success).toBe(true);
    expect(ScheduleActionResult.safeParse({ ok: false, error: "稍后重试" }).success).toBe(true);
    expect(ScheduleActionResult.safeParse({ ok: false }).success).toBe(false);
  });
});
