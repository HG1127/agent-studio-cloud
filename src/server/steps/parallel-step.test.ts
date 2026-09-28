import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persistStep: vi.fn(),
  appendTrace: vi.fn(),
}));

vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));

import type { WorkflowNode } from "@/contracts/workflow";
import { JsonStorageRecord } from "@/contracts/json";
import { finishParallel } from "@/server/steps/parallel-step";

describe("并行节点完成轨迹", () => {
  beforeEach(() => vi.clearAllMocks());

  it("所有分支完成时用 null 表示没有采用单一分支", async () => {
    await finishParallel({
      runId: "run-1",
      node: { id: "parallel-1", title: "并行处理", type: "parallel" } as WorkflowNode,
      output: { strategy: "all", status: "completed", completedCount: 2, failedCount: 0 },
      failed: false,
      handled: false,
    });

    const event = mocks.appendTrace.mock.calls[0]?.[0];
    expect(event.data.selectedBranchId).toBeNull();
    expect(JsonStorageRecord.safeParse(event.data).success).toBe(true);
  });
});
