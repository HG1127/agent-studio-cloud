"use step";
import { eq } from "drizzle-orm";
import { FatalError, getStepMetadata, getWorkflowMetadata } from "workflow";
import { DefaultResultDeliveryInput, type DefaultResultDeliveryStepResult } from "@/contracts/default-result-delivery";
import { db } from "@/lib/db";
import { runs } from "@/db/schema";
import { defaultResultDeliveryHookToken } from "@/server/domain/runtime/default-result-delivery";
import { deliverDefaultResult, prepareDefaultResultDeliveryWait, readDefaultResultDelivery } from "@/server/services/default-result-delivery";
import { withSafeWorkflowError } from "@/server/security/workflow-error";

async function ownedWorkspace(runId: string): Promise<string> {
  DefaultResultDeliveryInput.parse({ runId });
  const [run] = await withSafeWorkflowError(() => db.select({ workspaceId: runs.workspaceId, sdkRunId: runs.workflowRunId })
    .from(runs).where(eq(runs.id, runId)).limit(1), "成果投递归属暂时无法读取，请稍后重试");
  if (!run || run.sdkRunId !== getWorkflowMetadata().workflowRunId) throw new FatalError("成果投递不属于当前主流程");
  return run.workspaceId;
}

export async function deliverDefaultResultStep(runId: string): Promise<DefaultResultDeliveryStepResult> {
  "use step";
  return deliverDefaultResult(runId, await ownedWorkspace(runId));
}

export async function readDefaultResultDeliveryStateStep(runId: string): Promise<DefaultResultDeliveryStepResult> {
  "use step";
  const record = await readDefaultResultDelivery(runId, await ownedWorkspace(runId));
  if (!record) throw new FatalError("主流程冻结成果不存在");
  return { status: record.status, hookToken: defaultResultDeliveryHookToken(record) };
}

export async function prepareDefaultResultDeliveryWaitStep(runId: string): Promise<DefaultResultDeliveryStepResult> {
  "use step";
  return prepareDefaultResultDeliveryWait(runId, await ownedWorkspace(runId), getStepMetadata().stepId);
}
