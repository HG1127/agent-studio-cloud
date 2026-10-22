import { AgentTargetOption } from "@/contracts/agent";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";

export const collaborationAgentId = "00000000-0000-4000-8000-000000000061";
export const collaborationTarget = AgentTargetOption.parse({ agentId: "00000000-0000-4000-8000-000000000062", agentName: "研究助手", versionId: "00000000-0000-4000-8000-000000000063", version: 3,
  inputContract: { fields: [{ name: "brief", label: "新版名称", type: "string" }] }, outputContract: { fields: [{ path: "summary", label: "新版结论" }] },
});
export const collaborationCall = WorkflowNode.parse({ id: "call", title: "核对客户背景", type: "agent_call", next: "handoff", agentCall: { targetAgentId: collaborationTarget.agentId, targetAgentName: "原研究助手", versionId: collaborationTarget.versionId,
  inputContract: { fields: [{ name: "brief", label: "冻结的任务说明", type: "string" }] }, outputContract: { fields: [{ path: "summary", label: "冻结的研究结果" }] }, memoryAccess: { mode: "self" } },
});
export const collaborationHandoff = WorkflowNode.parse({ id: "handoff", title: "交付给研究助手", type: "handoff", next: "group", toAgent: { id: collaborationTarget.agentId, name: "研究助手", versionId: collaborationTarget.versionId },
  contract: { deliverables: ["分析结论"], mustNotInclude: ["密钥"], inputSchema: [{ name: "brief", label: "传入说明", type: "string" }], outputSchema: [{ name: "result", label: "交付结论", type: "object" }], memoryPolicy: { mode: "none" } },
});
export const collaborationDraft = WorkflowDraft.parse({ id: "collaboration-test", rootAgent: { id: collaborationAgentId, name: "客户助手", role: "业务助手" }, nodes: {
  start: { id: "start", title: "开始", type: "trigger", next: "call" }, call: collaborationCall, handoff: collaborationHandoff,
  group: { id: "group", title: "交付准备", type: "subflow", next: "done", subflow: { name: "准备", steps: [{ ...collaborationHandoff, id: "inner", title: "组内交接", next: null }] } },
  done: { id: "done", title: "完成", type: "end" },
}, memoryPolicy: { taskContext: true, longTerm: false } });
