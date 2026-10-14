import type { ApprovalDecisionInput, RunStatus } from "@/contracts/run";
import type { RunApprovalState } from "@/contracts/run-approval";
import { redactCredentialText } from "@/server/domain/security/redact-sensitive";

export function normalizeApprovalNote(note?: string | null): string | null {
  return note?.trim() ? redactCredentialText(note.trim()) : null;
}

export function approvalTaskState(status: string, runStatus: RunStatus, consumed: boolean): RunApprovalState {
  if (status === "pending") return runStatus === "waiting_approval" ? "pending" : "unavailable";
  if (status !== "approved" && status !== "rejected") return "unavailable";
  if (consumed || ["running", "waiting_event", "completed", "failed"].includes(runStatus)) return "processed";
  return runStatus === "waiting_approval" ? "resume-needed" : "unavailable";
}

export function approvalDecisionPolicy(args: {
  status: string; note: string | null; runStatus: RunStatus; consumed: boolean;
  request: Pick<ApprovalDecisionInput, "decision" | "note">;
}): "decide" | "resume" | "accepted" | "conflict" | "unavailable" {
  if (args.status !== "pending" && (args.status !== args.request.decision || normalizeApprovalNote(args.note) !== normalizeApprovalNote(args.request.note))) return "conflict";
  const state = approvalTaskState(args.status, args.runStatus, args.consumed);
  return state === "pending" ? "decide" : state === "resume-needed" ? "resume" : state === "processed" ? "accepted" : "unavailable";
}
