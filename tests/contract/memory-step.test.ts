import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  insertValues: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  persistStep: vi.fn(),
  appendTrace: vi.fn(),
  stepId: "contract-step",
}));

vi.mock("workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("workflow")>();
  return { ...actual, getStepMetadata: () => ({ stepId: mocks.stepId }) };
});
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      const result = mocks.selectResults.shift() ?? [];
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(result),
      };
      return chain;
    },
    insert: () => ({
      values: (value: unknown) => {
        mocks.insertValues(value);
        return { onConflictDoUpdate: mocks.onConflictDoUpdate };
      },
    }),
  },
}));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));

import { runMemoryStep } from "@/server/steps/memory-step";

const runContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  createdBy: "00000000-0000-4000-8000-000000000002",
  agentId: "00000000-0000-4000-8000-000000000003",
};

function memoryNode(mode: "read" | "write") {
  return WorkflowNode.parse({
    id: `memory_${mode}`,
    title: mode === "read" ? "参考过往经验" : "保存本次经验",
    type: "memory",
    memory: mode === "read" ? { mode, query: "客户续约", limit: 2 } : { mode, contentFrom: "run_summary" },
  });
}

describe("长期经验步骤", () => {
  beforeEach(() => {
    mocks.selectResults.length = 0;
    mocks.insertValues.mockReset();
    mocks.onConflictDoUpdate.mockReset().mockResolvedValue(undefined);
    mocks.persistStep.mockReset().mockResolvedValue(undefined);
    mocks.appendTrace.mockReset().mockResolvedValue(undefined);
  });

  it("幂等保存去敏后的本次结果", async () => {
    mocks.selectResults.push([runContext]);
    const result = await runMemoryStep({
      runId: "00000000-0000-4000-8000-000000000004",
      node: memoryNode("write"),
      input: { customer: "甲公司", apiKey: "sk-private" },
      outputs: { summary: "续约方案已完成" },
    });
    expect(result.output).toMatchObject({ mode: "write", saved: true });
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: runContext.workspaceId,
      agentId: runContext.agentId,
      sourceNodeId: "memory_write:contract-step",
      content: expect.stringContaining("续约方案已完成"),
    }));
    expect(JSON.stringify(mocks.insertValues.mock.calls)).not.toContain("sk-private");
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledOnce();
  });

  it("只返回与查询相关的历史经验", async () => {
    mocks.selectResults.push([runContext], [
      { content: "客户续约需要提前沟通", createdAt: new Date("2026-02-01") },
      { content: "采购审批需要负责人确认", createdAt: new Date("2026-03-01") },
    ]);
    const result = await runMemoryStep({
      runId: "00000000-0000-4000-8000-000000000005",
      node: memoryNode("read"),
      input: {},
      outputs: {},
    });
    expect(result.output).toMatchObject({ mode: "read", foundCount: 1 });
    expect(result.output.memories).toEqual([
      { content: "客户续约需要提前沟通", savedAt: "2026-02-01T00:00:00.000Z" },
    ]);
  });
});
