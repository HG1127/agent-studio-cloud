import { describe, expect, it } from "vitest";
import { runStatusConfirmsWaitEventSubmission } from "@/server/domain/wait-event-submission";

describe("等待消息回执确认", () => {
  it("只把已经继续执行或完成的运行视为消息已接收", () => {
    expect(runStatusConfirmsWaitEventSubmission("running")).toBe(true);
    expect(runStatusConfirmsWaitEventSubmission("completed")).toBe(true);
    expect(runStatusConfirmsWaitEventSubmission("waiting_event")).toBe(false);
    expect(runStatusConfirmsWaitEventSubmission("failed")).toBe(false);
    expect(runStatusConfirmsWaitEventSubmission("cancelled")).toBe(false);
  });
});
