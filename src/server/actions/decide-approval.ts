"use server";

import type { ApprovalDecisionInput, ApprovalDecisionResult } from "@/contracts/run";
import { decideApprovalCore } from "@/server/services/decide-approval";

export async function decideApprovalAction(runId: string, approvalId: string, input: ApprovalDecisionInput): Promise<ApprovalDecisionResult> {
  return decideApprovalCore(runId, approvalId, input);
}
