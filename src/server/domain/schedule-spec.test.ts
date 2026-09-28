import { describe, expect, it } from "vitest";
import { nextOccurrenceAfterDue } from "./schedule-spec";

describe("错过触发时的下一次定时", () => {
  it("间隔任务跳过错过的时间槽，并保留原有节奏", () => {
    const dueAt = new Date("2026-09-26T00:00:00.000Z");
    const now = new Date("2026-09-26T00:17:00.000Z");

    expect(nextOccurrenceAfterDue({ kind: "interval", minutes: 5 }, dueAt, now)?.toISOString())
      .toBe("2026-09-26T00:20:00.000Z");
  });

  it("恰好到达时间槽时推进到下一格", () => {
    const dueAt = new Date("2026-09-26T00:00:00.000Z");

    expect(nextOccurrenceAfterDue({ kind: "interval", minutes: 5 }, dueAt, dueAt)?.toISOString())
      .toBe("2026-09-26T00:05:00.000Z");
  });

  it("日任务从当前时刻寻找下一时间槽，不补跑历史日期", () => {
    const dueAt = new Date("2026-09-20T01:00:00.000Z");
    const now = new Date("2026-09-26T03:00:00.000Z");

    expect(nextOccurrenceAfterDue({ kind: "daily", times: ["09:00", "15:00"] }, dueAt, now)?.toISOString())
      .toBe("2026-09-26T07:00:00.000Z");
  });

  it("一次性任务只执行已到期的这一次", () => {
    expect(nextOccurrenceAfterDue(
      { kind: "once", at: "2026-09-26T01:00:00.000Z" },
      new Date("2026-09-26T01:00:00.000Z"),
      new Date("2026-09-27T00:00:00.000Z"),
    )).toBeNull();
  });
});
