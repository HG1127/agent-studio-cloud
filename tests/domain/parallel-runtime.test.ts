import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";

function parallelNode(overrides: Record<string, unknown> = {}) {
  return WorkflowNode.parse({
    id: "parallel",
    title: "并行准备材料",
    type: "parallel",
    parallel: {
      strategy: "all",
      failurePolicy: "fail_fast",
      branches: [
        { id: "market", label: "市场材料", steps: [{ id: "draft", title: "整理市场材料", type: "ai" }] },
        { id: "risk", label: "风险材料", steps: [{ id: "check", title: "整理风险材料", type: "system" }] },
      ],
    },
    ...overrides,
  });
}

describe("并行分支运行准备", () => {
  it("为分支内步骤生成互不冲突的运行标识", () => {
    const result = prepareParallelBranches(parallelNode());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.branches.map((branch) => branch.steps[0].id)).toEqual([
      "parallel.market.draft",
      "parallel.risk.check",
    ]);
  });

  it("拒绝重复分支标识与暂时无法安全取消的任一完成策略", () => {
    const duplicate = parallelNode({
      parallel: {
        strategy: "all",
        failurePolicy: "continue",
        branches: [
          { id: "same", label: "工作一", steps: [{ id: "one", title: "步骤一", type: "ai" }] },
          { id: "same", label: "工作二", steps: [{ id: "two", title: "步骤二", type: "ai" }] },
        ],
      },
    });
    expect(prepareParallelBranches(duplicate)).toMatchObject({ ok: false, error: expect.stringContaining("重复") });

    const any = parallelNode({
      parallel: {
        strategy: "any",
        failurePolicy: "continue",
        branches: parallelNode().parallel?.branches,
      },
    });
    expect(prepareParallelBranches(any)).toMatchObject({ ok: false, error: expect.stringContaining("安全取消") });
  });

  it("拒绝需要暂停或再次编排的分支内步骤", () => {
    const node = parallelNode({
      parallel: {
        strategy: "all_settled",
        failurePolicy: "continue",
        branches: [
          { id: "approval", label: "人工确认", steps: [{ id: "review", title: "等待确认", type: "human" }] },
          { id: "content", label: "内容准备", steps: [{ id: "draft", title: "整理内容", type: "ai" }] },
        ],
      },
    });
    expect(prepareParallelBranches(node)).toMatchObject({ ok: false, error: expect.stringContaining("human") });
  });
});
