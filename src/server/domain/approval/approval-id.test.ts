import { describe, expect, it } from "vitest";
import { approvalRecordId } from "@/server/domain/approval/approval-id";

describe("确认记录稳定标识", () => {
  it("同一持久步骤重试时复用相同 UUID", () => {
    const first = approvalRecordId("run-1", "confirm", "step-1");
    const retried = approvalRecordId("run-1", "confirm", "step-1");

    expect(retried).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("循环再次执行或不同节点会生成不同记录", () => {
    const original = approvalRecordId("run-1", "confirm", "step-1");
    expect(approvalRecordId("run-1", "confirm", "step-2")).not.toBe(original);
    expect(approvalRecordId("run-1", "other", "step-1")).not.toBe(original);
    expect(approvalRecordId("run-2", "confirm", "step-1")).not.toBe(original);
  });
});
