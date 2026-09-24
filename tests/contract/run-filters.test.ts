import { describe, expect, it } from "vitest";
import { RunListFilters } from "@/contracts/run";

describe("运行筛选契约", () => {
  it("只接受已知状态、来源和有效助手标识", () => {
    expect(RunListFilters.safeParse({ status: "failed", sourceType: "schedule" }).success).toBe(true);
    expect(RunListFilters.safeParse({ status: "unknown" }).success).toBe(false);
    expect(RunListFilters.safeParse({ agentId: "not-an-id" }).success).toBe(false);
  });
});
