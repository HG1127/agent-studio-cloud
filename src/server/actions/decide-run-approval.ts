"use server";

import { RunApprovalDecisionInput, type RunApprovalDecisionResult } from "@/contracts/run-approval";
import { decideApprovalCore } from "@/server/services/decide-approval";

export async function decideRunApprovalAction(input: RunApprovalDecisionInput): Promise<RunApprovalDecisionResult> {
  const parsed = RunApprovalDecisionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "请明确确认本次决定，且沿用正确的任务与确认记录" };
  const { runId, approvalId, decision, note } = parsed.data;
  const result = await decideApprovalCore(runId, approvalId, { decision, ...(note === undefined ? {} : { note }) }, true);
  return result.ok ? { ok: true, runId, approvalId, decision, recorded: true } : result;
}
