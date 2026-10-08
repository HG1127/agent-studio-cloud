import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";
import { buildAgentCallInput as buildAgentCallInputResult, validateAgentCallNode, validateAgentCallOutput } from "@/server/domain/runtime/agent-call-runtime";
import { compileModelWorkflowPlan } from "@/server/domain/compile";

function buildAgentCallInput(args: Parameters<typeof buildAgentCallInputResult>[0]) {
  const result = buildAgentCallInputResult(args);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.input;
}

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
  it("显式映射保留业务对象类型，不再按目标名称猜测或补充全文上下文", () => {
    const typed = AgentManifest.parse({ ...targetManifest, inputContract: { fields: [
      { name: "amount", type: "number" }, { name: "approved", type: "boolean" }, { name: "customer", type: "object" },
    ] } });
    const node = WorkflowNode.parse({ id: "call", title: "处理金额", type: "agent_call", agentCall: { targetAgentId: "target", versionId: "version" }, inputMapping: { fields: [
      { target: ["amount"], source: { kind: "output", nodeId: "extract", path: ["amount"] } },
      { target: ["approved"], source: { kind: "literal", value: false } },
      { target: ["customer"], source: { kind: "input", path: ["customer"] } },
    ] } });
    expect(buildAgentCallInput({ node, targetManifest: typed, input: { customer: { id: "c1" }, other: "not-selected" }, outputs: { extract: { amount: 0 }, other: "not-selected" } }))
      .toEqual({ amount: 0, approved: false, customer: { id: "c1" } });
  });
  it("映射缺失明确失败，不用文字上下文伪装成业务字段", () => {
    const node = WorkflowNode.parse({ id: "call", title: "处理金额", type: "agent_call", agentCall: { targetAgentId: "target", versionId: "version" }, inputMapping: { fields: [
      { target: ["brief"], source: { kind: "input", path: ["missing"] } },
    ] } });
    expect(buildAgentCallInputResult({ node, targetManifest, input: { note: "not-selected" }, outputs: {} })).toMatchObject({ ok: false, error: expect.stringContaining("缺少映射字段") });
  });
  it("映射前和映射后均脱敏，重命名、固定值和兜底不能复制密钥", () => {
    const node = WorkflowNode.parse({ id: "call", title: "处理金额", type: "agent_call", agentCall: { targetAgentId: "target", versionId: "version" }, inputMapping: { fields: [
      { target: ["brief"], source: { kind: "input", path: ["apiKey"] } },
      { target: ["token"], source: { kind: "literal", value: "literal-private-value" } },
      { target: ["note"], source: { kind: "input", path: ["missing"] }, fallback: "Bearer abcdefghijklmnop" },
    ] } });
    const input = buildAgentCallInput({ node, targetManifest, input: { apiKey: "source-private-value" }, outputs: {} });
    expect(input).toEqual({ brief: "[已隐藏敏感信息]", token: "[已隐藏敏感信息]", note: "[已隐藏敏感信息]" });
  });
  it("私有模式不能通过嵌套成果读取长期经验，团队模式可显式映射", () => {
    const base = { id: "call", title: "引用经验", type: "agent_call", agentCall: { targetAgentId: "target", versionId: "version", memoryAccess: { mode: "none" } }, inputMapping: { fields: [
      { target: ["brief"], source: { kind: "output", nodeId: "group", path: ["steps", "0", "output", "memories", "0", "content"] } },
    ] } };
    const outputs = { group: { steps: [{ output: { mode: "read", memories: [{ content: "private-memory" }] } }] } };
    const node = WorkflowNode.parse(base);
    expect(buildAgentCallInputResult({ node, targetManifest, input: {}, outputs }).ok).toBe(false);
    const team = WorkflowNode.parse({ ...base, agentCall: { ...base.agentCall, memoryAccess: { mode: "team" } } });
    expect(buildAgentCallInput({ node: team, targetManifest, input: {}, outputs })).toEqual({ brief: "private-memory" });
  });
  it("旧上下文路径也移除嵌套经验，不仅保护新映射", () => {
    const node = WorkflowNode.parse({ id: "call", title: "旧协作", type: "agent_call", agentCall: { targetAgentId: "target", versionId: "version" } });
    const outputs = { group: { steps: [{ output: { mode: "write", saved: true, content: "private-memory" } }] } };
    expect(JSON.stringify(buildAgentCallInput({ node, targetManifest, input: {}, outputs }))).not.toContain("private-memory");
  });
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
