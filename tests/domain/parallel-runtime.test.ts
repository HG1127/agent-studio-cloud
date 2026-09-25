import { describe, expect, it } from "vitest";
import { MAX_PARALLEL_BRANCHES, MAX_PARALLEL_STEPS, WorkflowNode } from "@/contracts/workflow";
import { prepareParallelBranches, resolveParallelOutcome } from "@/server/domain/runtime/parallel-runtime";

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

  it("拒绝重复分支标识并接受任一成功策略", () => {
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
    expect(prepareParallelBranches(any)).toMatchObject({ ok: true });
  });

  it("拒绝同一并行工作内重复的步骤标识", () => {
    const duplicateSteps = parallelNode({
      parallel: {
        strategy: "all",
        failurePolicy: "fail_fast",
        branches: [
          { id: "market", label: "市场材料", steps: [
            { id: "same", title: "步骤一", type: "system" },
            { id: "same", title: "步骤二", type: "system" },
          ] },
          { id: "risk", label: "风险材料", steps: [{ id: "check", title: "整理风险", type: "system" }] },
        ],
      },
    });
    expect(prepareParallelBranches(duplicateSteps)).toMatchObject({ ok: false, error: expect.stringContaining("重复的步骤标识") });
  });

  it("任一成功时继续并选中成功分支，全部失败时进入失败路径", () => {
    expect(resolveParallelOutcome({ strategy: "any", failurePolicy: "fail_fast", statuses: ["failed", "completed"] })).toEqual({
      status: "completed",
      shouldFail: false,
      selectedIndex: 1,
    });
    expect(resolveParallelOutcome({ strategy: "any", failurePolicy: "continue", statuses: ["failed", "failed"] })).toEqual({
      status: "failed",
      shouldFail: true,
      selectedIndex: null,
    });
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

  it("允许经验与多助手自动步骤进入并行分支", () => {
    const node = parallelNode({
      parallel: {
        strategy: "all",
        failurePolicy: "fail_fast",
        branches: [
          { id: "memory", label: "读取经验", steps: [{ id: "read", title: "读取经验", type: "memory", memory: { mode: "read" } }] },
          { id: "agent", label: "助手协作", steps: [{ id: "call", title: "助手协作", type: "agent_call", agentCall: { targetAgentId: "target", versionId: "version" } }] },
        ],
      },
    });
    expect(prepareParallelBranches(node)).toMatchObject({ ok: true });
  });

  it("即使旧版本绕过新契约也拒绝过量并发和过长分支", () => {
    const tooManyBranches = parallelNode();
    tooManyBranches.parallel!.branches = Array.from({ length: MAX_PARALLEL_BRANCHES + 1 }, (_, index) => ({
      id: `branch_${index}`, label: `工作 ${index}`, inputs: [], outputs: [], steps: [{ id: "step", title: "处理", type: "ai" }],
    }));
    expect(prepareParallelBranches(tooManyBranches)).toMatchObject({ ok: false, error: expect.stringContaining("最多允许") });

    const tooManySteps = parallelNode();
    tooManySteps.parallel!.branches[0].steps = Array.from({ length: MAX_PARALLEL_STEPS + 1 }, (_, index) => ({ id: `step_${index}`, title: `步骤 ${index}`, type: "ai" }));
    expect(prepareParallelBranches(tooManySteps)).toMatchObject({ ok: false, error: expect.stringContaining("最多允许") });
  });
});
