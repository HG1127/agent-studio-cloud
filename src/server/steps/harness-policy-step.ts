"use step";
import { FatalError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import type { HarnessSubject } from "@/contracts/harness";
import { evaluateHarnessPolicy, parseHarnessPolicy } from "@/server/domain/harness/policy";
import { HarnessPolicyDataError, evaluateFrozenHarnessPolicy } from "@/server/domain/harness/management";
import { readRunHarnessPolicy } from "@/server/services/harness-policies";
import { withSafeWorkflowError } from "@/server/security/workflow-error";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export async function enforceHarnessPolicy(args: { runId: string; node: WorkflowNode; executionType?: "ai" | "tool" }): Promise<void> {
  "use step";
  const { node } = args;
  const nodeType = args.executionType ?? node.type;
  if (nodeType !== "ai" && nodeType !== "tool") return;
  const policy = parseHarnessPolicy(process.env.HARNESS_POLICY_JSON);
  const subject: HarnessSubject = {
    nodeType, nodeId: node.id, registryToolId: node.tool?.registryToolId, scope: node.tool?.scope, risk: node.tool?.risk,
  };
  let decision = policy ? { allowed: evaluateHarnessPolicy(policy, subject).allowed, invalid: false } : { allowed: false, invalid: true };
  if (decision.allowed) {
    try {
      const frozen = await withSafeWorkflowError(async () => {
        try { return await readRunHarnessPolicy(args.runId); }
        catch (error) {
          if (error instanceof HarnessPolicyDataError) throw new FatalError(error.message);
          throw error;
        }
      }, "运行规则暂时无法读取，请稍后重试");
      decision = evaluateFrozenHarnessPolicy({ administrator: policy, ...frozen, subject });
    } catch (error) {
      if (!FatalError.is(error)) throw error;
      decision = { allowed: false, invalid: true };
    }
  }
  const reason = decision.invalid ? "运行策略配置无效，已阻止模型和工具调用" : "运行策略禁止执行这一步";
  await appendTrace({
    runId: args.runId, nodeId: node.id, kind: "harness.policy", level: decision.allowed ? "info" : "warn",
    title: decision.allowed ? `「${node.title}」通过运行策略检查` : `「${node.title}」被运行策略阻止`,
    // 管理员填写的原因可能包含凭据，轨迹只记录固定文案。
    detail: decision.allowed ? null : reason, data: { decision: decision.allowed ? "allow" : "deny", nodeType },
  });
  if (decision.allowed) return;
  await persistStep({ runId: args.runId, nodeId: node.id, nodeTitle: node.title, nodeType: node.type, status: "failed", error: reason });
  throw new FatalError(reason);
}
