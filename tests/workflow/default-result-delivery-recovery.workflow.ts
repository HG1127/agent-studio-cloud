import { createHook, FatalError } from "workflow";
import type { WorkflowDraft } from "@/contracts/workflow";
import { finalizeRun, initializeRun } from "@/server/steps/run-state";
import { awaitDefaultResultDelivery } from "@/server/workflows/default-result-delivery-hook";

export async function defaultResultDeliveryRecoveryWorkflow(
  runId: string,
  draft: WorkflowDraft,
  result: Record<string, unknown>,
  preparationToken: string,
) {
  "use workflow";
  await initializeRun(runId, draft);
  const completed = await finalizeRun(runId, result, { accepted: result, processOnly: "只保留运行上下文" });
  if (completed.kind !== "completed" || !completed.deliveryRequired) throw new FatalError("恢复验收夹具没有冻结新版主流程成果");

  // Freeze through production steps before the test scopes its World failure injection to this original root.
  const preparation = createHook<boolean>({ token: preparationToken });
  try {
    if (await preparation.getConflict()) throw new FatalError("恢复验收准备入口发生冲突");
    await preparation;
  } finally {
    preparation.dispose();
  }
  await awaitDefaultResultDelivery(runId);
  return { status: "completed" as const, runId };
}
