import { createHook, getStepMetadata, RetryableError } from "workflow";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { enforceHarnessPolicy } from "@/server/steps/harness-policy-step";
import { initializeRun, persistStep } from "@/server/steps/run-state";

async function guardedProbeStep(runId: string, node: WorkflowNode, injectRetry: boolean) {
  "use step";
  const attempt = getStepMetadata().attempt;
  if (injectRetry && attempt < 2) throw new RetryableError("测试读取暂时不可用", { retryAfter: "1s" });
  await enforceHarnessPolicy({ runId, node });
  await persistStep({ runId, nodeId: node.id, nodeTitle: node.title, nodeType: node.type, status: "succeeded", output: { guarded: true, attempt } });
  return { guarded: true, attempt };
}

// 验证冻结、Hook、guard 与 SDK 重试；不调用业务模型/工具，也不代替成果投递验收。
export async function harnessPolicyManagementProbeWorkflow(args: {
  runId: string; draft: WorkflowDraft; node: WorkflowNode; token: string; legacyGuardOnly?: boolean; injectRetry?: boolean;
}) {
  "use workflow";
  if (!args.legacyGuardOnly) await initializeRun(args.runId, args.draft);
  const gate = createHook<boolean>({ token: args.token });
  try {
    await gate.getConflict();
    await gate;
    return await guardedProbeStep(args.runId, args.node, args.injectRetry === true);
  } finally {
    gate.dispose();
  }
}
