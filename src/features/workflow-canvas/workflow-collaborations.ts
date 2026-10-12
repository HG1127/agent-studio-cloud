import type { AgentTargetOption } from "@/contracts/agent";
import { AgentInputContract } from "@/contracts/manifest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { workflowStepGuide } from "./workflow-step-guide";

export interface WorkflowCollaboration {
  key: string;
  ownerNodeId: string;
  location: string;
  title: string;
  kind: "agent_call" | "handoff";
  targetName: string;
  targetHref: string | null;
  versionLabel: string;
  memoryLabel: string;
  inputLabels: string[] | null;
  outputLabels: string[] | null;
  node: WorkflowNode | null;
  issues: string[];
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function workflowCollaborations(draft: WorkflowDraft, targets: readonly AgentTargetOption[], currentAgentId: string): WorkflowCollaboration[] {
  const rows: WorkflowCollaboration[] = [];
  const visit = (raw: Record<string, unknown>, ownerNodeId: string, location: string, key: string, reachable: boolean) => {
    if (raw.type !== "agent_call" && raw.type !== "handoff") return;
    const kind = raw.type;
    const parsed = WorkflowNode.safeParse(raw);
    const node = parsed.success ? parsed.data : null;
    const binding = record(kind === "agent_call" ? raw.agentCall : raw.toAgent);
    const targetAgentId = text(kind === "agent_call" ? binding.targetAgentId : binding.id);
    const versionId = text(binding.versionId);
    const target = targets.find((option) => option.agentId === targetAgentId && option.versionId === versionId);
    const issues: string[] = [];
    if (!node) issues.push("协作设置格式不完整，请回到步骤核对");
    if (!targetAgentId || !versionId) issues.push("还没有选择完整的固定助手版本");
    else if (targetAgentId === currentAgentId) issues.push("不能呼叫或交接给当前助手自身");
    else if (!target) issues.push("当前清单未显示原固定版本，需再次核对，不等于版本已失效");
    if (!reachable) issues.push("所在画布步骤还未接入从开始步骤出发的路径");
    const contract = node?.contract;
    if (kind === "handoff" && node && (!contract?.deliverables.length || !contract.mustNotInclude.length || !contract.inputSchema.length || !contract.outputSchema.length || !contract.memoryPolicy)) {
      issues.push("交接约定缺项，请核对交付、禁止内容、输入返回字段和经验范围");
    }
    if (kind === "handoff" && contract?.memoryPolicy?.shared.length) issues.push("原共享名称不是当前执行的经验白名单");
    const input = kind === "agent_call" ? AgentInputContract.safeParse(node?.agentCall?.inputContract) : null;
    const output = kind === "agent_call" ? WorkflowDraft.shape.outputContract.safeParse(node?.agentCall?.outputContract) : null;
    if (kind === "agent_call" && node && (!input?.success || !output?.success || !output.data)) issues.push("冻结的输入或返回约定尚不完整");
    const mode = kind === "handoff" ? contract?.memoryPolicy?.mode : node?.agentCall?.memoryAccess?.mode;
    rows.push({
      key, ownerNodeId, location, kind, node, issues,
      title: text(raw.title) || "未命名协作步骤",
      targetName: text(kind === "agent_call" ? binding.targetAgentName : binding.name) || target?.agentName || (targetAgentId ? "原协作助手（名称未记录）" : "尚未选择助手"),
      targetHref: target && target.agentId !== currentAgentId ? `/agents/${target.agentId}` : null,
      versionLabel: target ? `固定版本 ${target.version}` : versionId ? "已固定版本，当前清单未显示" : "尚未固定版本",
      memoryLabel: !node ? "经验范围暂不可读" : mode === "team" ? "允许传递上游经验步骤结果" : mode === "none" ? "不传递上游经验步骤结果" : mode === "self" ? "不传递上游经验（保留原设置）" : kind === "agent_call" ? "未设置范围（不传递上游经验）" : "尚未设置经验范围",
      inputLabels: kind === "handoff" ? contract?.inputSchema.map((field, index) => field.label?.trim() || `传入内容 ${index + 1}`) ?? null : input?.success ? input.data.fields.map((field, index) => field.label?.trim() || `传入内容 ${index + 1}`) : null,
      outputLabels: kind === "handoff" ? contract?.outputSchema.map((field, index) => field.label?.trim() || `返回内容 ${index + 1}`) ?? null : output?.success && output.data ? output.data.fields.map((field, index) => field.label?.trim() || `返回内容 ${index + 1}`) : null,
    });
  };
  for (const { node, reachable } of workflowStepGuide(draft, true)) {
    visit(node, node.id, "主流程", node.id, reachable);
    if (node.type === "parallel") node.parallel?.branches.forEach((branch, branchIndex) => {
      branch.steps.forEach((step, index) => visit(step, node.id, `${node.title} · ${branch.label} · 第 ${index + 1} 步`, `${node.id}:parallel:${branchIndex}:${index}`, reachable));
    });
    if (node.type === "subflow") node.subflow?.steps.forEach((step, index) => visit(step, node.id, `${node.title} · 第 ${index + 1} 步`, `${node.id}:subflow:${index}`, reachable));
  }
  return rows;
}
