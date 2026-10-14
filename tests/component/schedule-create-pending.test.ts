import { describe, expect, it } from "vitest";
import {
  restoreScheduleCreatePending,
  serializeScheduleCreatePending,
} from "@/features/schedules/schedule-create-pending";

const pending = {
  agentName: "合同审核助手",
  summary: "每天 09:00",
  submittedAt: "2026-09-28T00:00:00.000Z",
};

describe("定时任务创建结果核对提示", () => {
  it("只恢复非敏感的核对线索", () => {
    expect(restoreScheduleCreatePending(serializeScheduleCreatePending(pending))).toEqual(pending);
  });

  it("拒绝损坏、过期版本和无效内容", () => {
    expect(restoreScheduleCreatePending("{")).toBeNull();
    expect(restoreScheduleCreatePending(JSON.stringify({ formatVersion: 2, ...pending }))).toBeNull();
    expect(restoreScheduleCreatePending(JSON.stringify({ formatVersion: 1, ...pending, submittedAt: "bad" }))).toBeNull();
    expect(restoreScheduleCreatePending(null)).toBeNull();
  });
});
