import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";
import { buildAgentCallInput, validateAgentCallNode } from "@/server/domain/runtime/agent-call-runtime";
import { compileModelWorkflowPlan } from "@/server/domain/compile";

const targetManifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "a".repeat(64),
  inputContract: { fields: [{ name: "customer", required: true }, { name: "brief", required: true }] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "target",
    rootAgent: { id: "target", name: "协作助手", role: "研究" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: { start: { id: "start", title: "开始", type: "trigger", next: "done" }, done: { id: "done", title: "结束", type: "end" } },
  },
});

describe("助手调用运行逻辑", () => {
  it("按目标输入契约映射已有字段，并为缺失字段补充业务上下文", () => {
    const node = WorkflowNode.parse({ id: "call", title: "请研究助手分析", type: "agent_call", description: "分析客户情况", agentCall: { targetAgentId: "target", versionId: "version" } });
    const input = buildAgentCallInput({ node, targetManifest, input: { customer: "甲公司" }, outputs: { summary: "最近续约下降" } });
    expect(input.customer).toBe("甲公司");
    expect(String(input.brief)).toContain("最近续约下降");
    expect(String(input.brief)).toContain("分析客户情况");
  });

  it("阻止未绑定目标和直接调用自身", () => {
    const missing = WorkflowNode.parse({ id: "call", title: "调用助手", type: "agent_call", agentCall: { targetAgentId: "", versionId: "" } });
    expect(validateAgentCallNode(missing)).toContain("还没有选择");
    const self = WorkflowNode.parse({ id: "call", title: "调用助手", type: "agent_call", agentCall: { targetAgentId: "agent-a", versionId: "version" } });
    expect(validateAgentCallNode(self, "agent-a")).toContain("不能调用");
  });

  it("目标没有声明输入字段时仍传递完整上下文", () => {
    const noInputManifest = AgentManifest.parse({ ...targetManifest, inputContract: { fields: [] } });
    const node = WorkflowNode.parse({ id: "call", title: "调用助手", type: "agent_call", agentCall: { targetAgentId: "target", versionId: "version" } });
    const input = buildAgentCallInput({ node, targetManifest: noInputManifest, input: { topic: "续约" }, outputs: {} });
    expect(String(input.context)).toContain("续约");
  });

  it("模型流程编译器保留助手调用节点供画布绑定", () => {
    const result = compileModelWorkflowPlan({
      intent: {
        trigger: { value: "收到任务" },
        outputs: ["协作结果"],
        orderedSteps: [
          { id: "delegate", title: "请研究助手分析", type: "agent_call" },
          { id: "summarize", title: "汇总结果", type: "ai" },
        ],
      },
    });
    expect(result?.workflow.nodes.delegate).toMatchObject({
      type: "agent_call",
      agentCall: { targetAgentId: "", versionId: "", memoryAccess: { mode: "none" } },
    });
  });
});
