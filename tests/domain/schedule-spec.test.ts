import { describe, expect, it } from "vitest";
import { nextOccurrence } from "@/server/domain/schedule-spec";

// 基准均给 UTC 瞬间，断言换算成北京时间（UTC+8）后的墙上时间
describe("nextOccurrence", () => {
  it("once：未来返回同一瞬间，过去返回 null", () => {
    const from = new Date("2026-09-23T00:00:00Z");
    expect(nextOccurrence({ kind: "once", at: "2026-09-23T03:00:00Z" }, from)).toEqual(new Date("2026-09-23T03:00:00Z"));
    expect(nextOccurrence({ kind: "once", at: "2026-09-22T03:00:00Z" }, from)).toBeNull();
  });

  it("interval：from 加整数分钟", () => {
    const from = new Date("2026-09-23T02:00:00Z");
    expect(nextOccurrence({ kind: "interval", minutes: 5 }, from)).toEqual(new Date("2026-09-23T02:05:00Z"));
  });

  it("daily：多时间槽取当天下一个，过完取明天第一个", () => {
    const from = new Date("2026-09-23T02:30:00Z"); // 北京 10:30
    const next = nextOccurrence({ kind: "daily", times: ["09:30", "18:00"] }, from);
    expect(next).toEqual(new Date("2026-09-23T10:00:00Z")); // 北京 18:00
    const afterClose = new Date("2026-09-23T11:00:00Z"); // 北京 19:00
    const nextDay = nextOccurrence({ kind: "daily", times: ["09:30", "18:00"] }, afterClose);
    expect(nextDay).toEqual(new Date("2026-09-24T01:30:00Z")); // 次日北京 09:30
  });

  it("weekly：跳到下一个选中的星期几", () => {
    const from = new Date("2026-09-23T02:00:00Z"); // 周三
    const next = nextOccurrence({ kind: "weekly", weekdays: [1], times: ["09:00"] }, from);
    expect(next).toEqual(new Date("2026-09-28T01:00:00Z")); // 周一北京 09:00
  });

  it("monthly：跳到下一个选中日期（当月已过则跨月）", () => {
    const from = new Date("2026-09-23T02:00:00Z");
    const next = nextOccurrence({ kind: "monthly", days: [1, 15], times: ["12:00"] }, from);
    expect(next).toEqual(new Date("2026-10-01T04:00:00Z")); // 10 月 1 日北京 12:00
  });
});
