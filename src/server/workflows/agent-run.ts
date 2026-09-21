// 运行编排工作流：只做控制流与状态机推进，所有 I/O 与业务逻辑都在 "use step" 里。
import { createHook, FatalError } from "workflow";
import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import { requestApproval, recordDecision } from "@/server/steps/approval-step";
import { evaluateCondition } from "@/server/steps/condition-step";
import { runKnowledgeStep } from "@/server/steps/knowledge-step";
import { runModelStep } from "@/server/steps/model-step";
import { failRun, finalizeRun, initializeRun } from "@/server/steps/run-state";
import { runQualityGate } from "@/server/steps/quality-step";
import { runToolStep } from "@/server/steps/tool-step";

export async function agentRunWorkflow(runId: string, manifest: AgentManifest, input: Record<string, unknown>) {
  "use workflow";
  const draft = manifest.workflowSnapshot;
  await initializeRun(runId, draft);
  let currentId: string | null = draft.startNodeId;
  const outputs: Record<string, unknown> = {};
  let guard = 0;
  while (currentId && guard < 200) {
    guard += 1;
    // 显式标注打断 currentId 收窄与节点类型之间的推导环（TS7022）
    const node: WorkflowNode | undefined = draft.nodes[currentId];
    if (!node) break;
    if (node.type === "trigger") {
      currentId = node.next;
      continue;
    }
    if (node.type === "end") {
      await finalizeRun(runId, outputs);
      return { status: "completed" };
    }
    if (node.type === "ai") {
      const r = await runModelStep({ runId, node, outputs, input });
      outputs[node.id] = r.output;
      currentId = node.next;
      continue;
    }
    if (node.type === "tool") {
      const r = await runToolStep({ runId, node });
      outputs[node.id] = r.receipt;
      currentId = node.next;
      continue;
    }
    if (node.type === "knowledge") {
      const r = await runKnowledgeStep({ runId, node });
      outputs[node.id] = r.receipt;
      currentId = node.next;
      continue;
    }
    if (node.type === "condition") {
      currentId = await evaluateCondition({ runId, node, outputs, input });
      continue;
    }
    if (node.type === "rule") {
      currentId = await runQualityGate({ runId, node, outputs, nodes: draft.nodes });
      continue;
    }
    if (node.type === "system") {
      currentId = node.next;
      continue;
    }
    if (node.type === "human") {
      const { approvalId, token } = await requestApproval({ runId, node });
      const hook = createHook<{ decision: "approved" | "rejected"; note?: string }>({ token });
      const decision = await hook;
      await recordDecision({ runId, node, approvalId, decision });
      currentId = decision.decision === "approved" ? node.next : (node.rejectNext ?? "not_approved");
      continue;
    }
    // 其余节点类型 M1 不支持自动执行
    throw new FatalError(`步骤「${node.title}」暂不支持自动执行`);
  }
  await failRun(runId, guard >= 200 ? "步骤数超过安全上限，已停止" : "流程没有后续步骤，已停止");
  return { status: "failed" };
}
