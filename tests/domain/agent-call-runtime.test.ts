import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";
import { buildAgentCallInput, validateAgentCallNode, validateAgentCallOutput } from "@/server/domain/runtime/agent-call-runtime";
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

  it("按冻结结果契约拒绝协作助手漏交必填内容", () => {
    const node = WorkflowNode.parse({
      id: "call", title: "调用研究助手", type: "agent_call",
      agentCall: {
        targetAgentId: "target", versionId: "version",
        outputContract: { fields: [{ path: "report.summary", label: "研究摘要", required: true }] },
      },
    });
    expect(validateAgentCallOutput(node, {})).toBe("协作结果缺少“研究摘要”");
    expect(validateAgentCallOutput(node, { report: { summary: "" } })).toBe("协作结果缺少“研究摘要”");
    expect(validateAgentCallOutput(node, { report: { summary: "已完成" } })).toBeNull();
  });

  it("目标没有声明输入字段时仍传递完整上下文", () => {
    const noInputManifest = AgentManifest.parse({ ...targetManifest, inputContract: { fields: [] } });
    const node = WorkflowNode.parse({ id: "call", title: "调用助手", type: "agent_call", agentCall: { targetAgentId: "target", versionId: "version" } });
    const input = buildAgentCallInput({ node, targetManifest: noInputManifest, input: { topic: "续约" }, outputs: {} });
    expect(String(input.context)).toContain("续约");
  });

  it("缺失的可选非文字字段不使用文字上下文冒充", () => {
    const typedManifest = AgentManifest.parse({
      ...targetManifest,
      inputContract: { fields: [
        { name: "brief", type: "string", required: true },
        { name: "count", type: "number", required: false },
        { name: "confirmed", type: "boolean", required: false },
      ] },
    });
    const node = WorkflowNode.parse({ id: "call", title: "调用助手", type: "agent_call", agentCall: { targetAgentId: "target", versionId: "version" } });
    expect(buildAgentCallInput({ node, targetManifest: typedManifest, input: {}, outputs: {} })).toMatchObject({ brief: expect.any(String) });
    expect(buildAgentCallInput({ node, targetManifest: typedManifest, input: { count: 3, confirmed: false }, outputs: {} })).toMatchObject({ count: 3, confirmed: false });
  });

  it("协作上下文隐藏敏感字段且不读取对象原型", () => {
    const node = WorkflowNode.parse({ id: "call", title: "调用助手", type: "agent_call", agentCall: { targetAgentId: "target", versionId: "version" } });
    const inheritedManifest = AgentManifest.parse({ ...targetManifest, inputContract: { fields: [{ name: "toString", type: "string", required: true }] } });
    const input = buildAgentCallInput({
      node,
      targetManifest: inheritedManifest,
      input: { customer: "甲公司", apiKey: "sk-private" },
      outputs: { authorization: "Bearer private" },
    });
    expect(input.toString).toEqual(expect.any(String));
    expect(input.toString).not.toBe(Object.prototype.toString);
    expect(String(input.toString)).toContain("[已隐藏敏感信息]");
    expect(String(input.toString)).not.toContain("sk-private");
    expect(String(input.toString)).not.toContain("Bearer private");
  });

  it("只有团队共享模式会把长期经验放进协作上下文", () => {
    const noInputManifest = AgentManifest.parse({ ...targetManifest, inputContract: { fields: [] } });
    const memoryOutput = { mode: "read", foundCount: 1, memories: [{ content: "仅团队可见经验" }] };
    const privateNode = WorkflowNode.parse({
      id: "private", title: "私有协作", type: "agent_call",
      agentCall: { targetAgentId: "target", versionId: "version", memoryAccess: { mode: "none" } },
    });
    const teamNode = WorkflowNode.parse({
      id: "team", title: "团队协作", type: "agent_call",
      agentCall: { targetAgentId: "target", versionId: "version", memoryAccess: { mode: "team" } },
    });
    expect(String(buildAgentCallInput({ node: privateNode, targetManifest: noInputManifest, input: {}, outputs: { memory: memoryOutput } }).context))
      .not.toContain("仅团队可见经验");
    expect(String(buildAgentCallInput({ node: teamNode, targetManifest: noInputManifest, input: {}, outputs: { memory: memoryOutput } }).context))
      .toContain("仅团队可见经验");
  });

  it("大量上游结果不会让多个上下文字段重复撑大协作输入", () => {
    const node = WorkflowNode.parse({ id: "call", title: "调用助手", type: "agent_call", agentCall: { targetAgentId: "target", versionId: "version" } });
    const input = buildAgentCallInput({
      node,
      targetManifest,
      input: {},
      outputs: { report: "x".repeat(200_000) },
    });
    expect(String(input.customer)).toContain("已截断");
    expect(String(input.brief)).toContain("已截断");
    expect(JSON.stringify(input).length).toBeLessThan(30_000);
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
