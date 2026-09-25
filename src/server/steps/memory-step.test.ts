import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";

const mocks = vi.hoisted(() => {
  const conflict = vi.fn();
  const inserted = vi.fn();
  return {
    persistStep: vi.fn(),
    appendTrace: vi.fn(),
    conflict,
    inserted,
    stepId: "step-first",
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{
              workspaceId: "00000000-0000-4000-8000-000000000001",
              createdBy: "00000000-0000-4000-8000-000000000002",
              agentId: "00000000-0000-4000-8000-000000000003",
            }],
          }),
        }),
      }),
      insert: () => ({
        values: (value: unknown) => {
          inserted(value);
          return {
          onConflictDoUpdate: async (options: unknown) => {
            conflict(options);
          },
          };
        },
      }),
    },
  };
});

vi.mock("workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("workflow")>();
  return { ...actual, getStepMetadata: () => ({ stepId: mocks.stepId }) };
});
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));

import { runMemoryStep } from "@/server/steps/memory-step";

const node = WorkflowNode.parse({
  id: "save_memory",
  title: "保存处理经验",
  type: "memory",
  next: null,
  memory: { mode: "write", contentFrom: "draft" },
});

describe("长期经验写入步骤", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stepId = "step-first";
  });

  it("重放同一写入时保留员工设置的停用状态", async () => {
    await expect(runMemoryStep({
      runId: "00000000-0000-4000-8000-000000000004",
      node,
      input: {},
      outputs: { draft: { summary: "已完成退款核验" } },
    })).resolves.toMatchObject({ output: { mode: "write", saved: true } });

    expect(mocks.conflict).toHaveBeenCalledOnce();
    const options = mocks.conflict.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(options.set).toMatchObject({ content: expect.any(String), metadata: { nodeTitle: "保存处理经验" } });
    expect(options.set).not.toHaveProperty("archivedAt");
  });

  it("循环中的每次执行分别保存经验，步骤重试仍复用同一来源", async () => {
    const args = {
      runId: "00000000-0000-4000-8000-000000000004",
      node,
      input: {},
      outputs: { draft: { summary: "已完成退款核验" } },
    };

    await runMemoryStep(args);
    await runMemoryStep(args);
    mocks.stepId = "step-second";
    await runMemoryStep(args);

    const sourceNodeIds = mocks.inserted.mock.calls.map(
      ([value]) => (value as { sourceNodeId: string }).sourceNodeId,
    );
    expect(sourceNodeIds).toEqual([
      "save_memory:step-first",
      "save_memory:step-first",
      "save_memory:step-second",
    ]);
  });
});
