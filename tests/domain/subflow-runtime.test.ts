import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";

function subflowNode(steps: Array<Record<string, unknown>>) {
  return WorkflowNode.parse({
    id: "research",
    title: "完成专题研究",
    type: "subflow",
    subflow: {
      name: "专题研究",
      inputs: ["研究主题"],
      outputs: ["研究结论"],
      failurePolicy: "checkpoint",
      steps,
    },
  });
}

describe("一组步骤运行准备", () => {
  it("按顺序生成隔离的子步骤标识，并兼容未声明类型的内容步骤", () => {
    const result = prepareSubflow(subflowNode([
      { id: "collect", title: "收集材料", type: "knowledge", knowledge: { space: "业务知识库" } },
      { id: "draft", title: "形成结论" },
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => ({ id: step.id, type: step.type }))).toEqual([
      { id: "research.collect", type: "knowledge" },
      { id: "research.draft", type: "ai" },
    ]);
    expect(result.outputNames).toEqual(["研究结论"]);
  });

  it("拒绝重复标识与需要暂停的子步骤", () => {
    expect(prepareSubflow(subflowNode([
      { id: "same", title: "步骤一", type: "system" },
      { id: "same", title: "步骤二", type: "system" },
    ]))).toMatchObject({ ok: false, error: expect.stringContaining("重复") });

    expect(prepareSubflow(subflowNode([
      { id: "draft", title: "形成草稿", type: "ai" },
      { id: "review", title: "等待员工确认", type: "human" },
    ]))).toMatchObject({ ok: false, error: expect.stringContaining("human") });
  });

  it("允许经验与多助手自动步骤进入顺序子流程", () => {
    const result = prepareSubflow(subflowNode([
      { id: "memory", title: "读取经验", type: "memory", memory: { mode: "read" } },
      { id: "handoff", title: "交接助手", type: "handoff", toAgent: { id: "target", versionId: "version" } },
    ]));
    expect(result).toMatchObject({ ok: true });
  });
});
