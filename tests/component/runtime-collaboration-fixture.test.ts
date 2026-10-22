import { describe, expect, it } from "vitest";
import { compiledCollaborationDefinition } from "../fixtures/runtime-collaboration";
import { collaborationDraft } from "../fixtures/workflow-collaborations";
import { auditWorkflow } from "@/server/domain/audit";
import { AgentExportFile } from "@/contracts/agent";

describe("协作验收定义使用现有完整编译管道，不补造评分", () => {
  it("按实际需求编译业务依据和交付，保留传入的固定绑定，导入格式符合共享契约", () => {
    const saved = { ...collaborationDraft, nodes: { ...collaborationDraft.nodes,
      call: { ...collaborationDraft.nodes.call, agentCall: { ...collaborationDraft.nodes.call.agentCall!, workflowId: collaborationDraft.nodes.call.agentCall!.versionId } },
    } };
    const definition = compiledCollaborationDefinition("协作验收导入", saved);
    expect(AgentExportFile.safeParse(definition).success).toBe(true);
    expect(auditWorkflow(definition.workflow).issues.filter((issue) => issue.severity === "critical")).toEqual([]);
    expect(definition.workflow.nodes.call.agentCall).toEqual(saved.nodes.call.agentCall);
    expect(definition.workflow.nodes.handoff.toAgent).toEqual(collaborationDraft.nodes.handoff.toAgent);
    expect(definition.workflow.nodes.call.businessSpec).not.toBeNull();
    expect(definition.workflow.nodes.handoff.businessSpec).not.toBeNull();
    expect(Object.values(definition.workflow.nodes).filter((node) => ["agent_call", "handoff"].includes(node.type))).toHaveLength(2);
    expect(Object.values(definition.workflow.nodes).some((node) => node.type === "ai")).toBe(false);
    expect(definition.workflow.outputContract?.fields.length).toBeGreaterThan(0);
  });
  it("没有实际保存绑定时拒绝生成，不添加假助手和版本", () => {
    expect(() => compiledCollaborationDefinition("无绑定", { ...collaborationDraft, nodes: {} })).toThrow("需要实际保存的协作与交接绑定");
  });
});
