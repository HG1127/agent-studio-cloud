import { AgentExportFile } from "../../src/contracts/agent";
import type { WorkflowDraft } from "../../src/contracts/workflow";
import { compileModelWorkflowPlan } from "../../src/server/domain/compile/model-workflow-compiler";
import { finalizeAgentDraft } from "../../src/server/domain/pipeline";

export function compiledCollaborationDefinition(name: string, saved: WorkflowDraft) {
  const call = Object.values(saved.nodes).find((node) => node.type === "agent_call");
  const handoff = Object.values(saved.nodes).find((node) => node.type === "handoff");
  if (!call?.agentCall || !handoff?.toAgent || !handoff.contract) throw new Error("需要实际保存的协作与交接绑定");
  const steps = [
    { id: "call", title: "协作核对回复", type: "agent_call", evidence: "由协作助手核对回复", agentCall: call.agentCall },
    { id: "handoff", title: "交接核对回复", type: "handoff", evidence: "交接给协作助手完善回复", toAgent: handoff.toAgent, contract: handoff.contract },
  ];
  const intentText = steps.map((step) => step.evidence).join("，");
  const compiled = compileModelWorkflowPlan({ name, sourceText: intentText, intent: { orderedSteps: steps } });
  if (!compiled) throw new Error("现有编译器没有生成协作定义");
  const prepared = finalizeAgentDraft({ name, intentText, workflow: compiled.workflow,
    orderedSteps: compiled.orderedSteps as Parameters<typeof finalizeAgentDraft>[0]["orderedSteps"] });
  if (!prepared.draft || prepared.issues.some((issue) => issue.severity === "critical")) {
    throw new Error("现有编译和业务依据管道没有生成可发布协作定义：" + prepared.issues.filter((issue) => issue.severity === "critical").map((issue) => issue.code).join("、"));
  }
  return AgentExportFile.parse({ format: "agent-studio-cloud", formatVersion: 1, exportedAt: new Date().toISOString(),
    agent: { name, intentText, description: "仅用于真实协作运行的桌面验收" }, workflow: prepared.draft });
}
