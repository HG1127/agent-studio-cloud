import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { bindWorkflowRootAgent } from "@/server/domain/workflow-root-agent";

describe("根助手身份绑定", () => {
  it("使用数据库身份替换临时身份并保留角色与流程", () => {
    const draft = WorkflowDraft.parse({
      id: "draft",
      rootAgent: { id: "temporary", name: "旧名称", role: "合同审核" },
      nodes: {
        group: {
          id: "group",
          title: "分组处理",
          type: "subflow",
          agent: { id: "temporary", name: "旧名称", role: "合同审核" },
          subflow: {
            name: "核对",
            steps: [{ id: "check", title: "核对", type: "system", agent: { id: "temporary", name: "旧名称", role: "核对员" } }],
          },
          next: "done",
        },
        done: { id: "done", title: "完成", type: "end" },
      },
      memoryPolicy: { taskContext: true, longTerm: false },
    });

    const rebound = bindWorkflowRootAgent(draft, { id: "real-agent-id", name: "合同助手" });

    expect(rebound.rootAgent).toEqual({ id: "real-agent-id", name: "合同助手", role: "合同审核" });
    expect(rebound.nodes.group.agent).toEqual({ id: "real-agent-id", name: "合同助手", role: "合同审核" });
    expect((rebound.nodes.group.subflow?.steps[0] as { agent: unknown }).agent).toEqual({
      id: "real-agent-id",
      name: "合同助手",
      role: "核对员",
    });
    expect(draft.rootAgent).toEqual({ id: "temporary", name: "旧名称", role: "合同审核" });
    expect(draft.nodes.group.agent).toEqual({ id: "temporary", name: "旧名称", role: "合同审核" });
  });
});
