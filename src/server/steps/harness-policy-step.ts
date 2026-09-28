"use step";

import { FatalError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { evaluateHarnessPolicy, parseHarnessPolicy } from "@/server/domain/harness/policy";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export async function enforceHarnessPolicy(args: { runId: string; node: WorkflowNode }): Promise<void> {
  "use step";
  const { node } = args;
  if (node.type !== "ai" && node.type !== "tool") return;
  const policy = parseHarnessPolicy(process.env.HARNESS_POLICY_JSON);
  const decision = policy
    ? evaluateHarnessPolicy(policy, {
        nodeType: node.type,
        nodeId: node.id,
        registryToolId: node.tool?.registryToolId,
        scope: node.tool?.scope,
        risk: node.tool?.risk,
      })
    : { allowed: false as const, ruleId: null, reason: "运行策略配置无效，已阻止模型和工具调用" };
  await appendTrace({
    runId: args.runId,
    nodeId: node.id,
    kind: "harness.policy",
    level: decision.allowed ? "info" : "warn",
    title: decision.allowed ? `「${node.title}」通过运行策略检查` : `「${node.title}」被运行策略阻止`,
    detail: decision.reason,
    data: { decision: decision.allowed ? "allow" : "deny", ruleId: decision.ruleId, nodeType: node.type },
  });
  if (decision.allowed) return;
  await persistStep({
    runId: args.runId,
    nodeId: node.id,
    nodeTitle: node.title,
    nodeType: node.type,
    status: "failed",
    error: decision.reason,
  });
  throw new FatalError(decision.reason);
}
