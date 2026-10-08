import { createHook } from "workflow";
import { requestApproval, recordDecision, type RequestApprovalInput } from "@/server/steps/approval-step";
import { awaitApprovalDecision } from "@/server/workflows/approval-hook";

export async function approvalRegistrationRaceWorkflow(args: RequestApprovalInput) {
  "use workflow";
  const gate = createHook<boolean>({ token: `test-approval-registration:${args.runId}` });
  try {
    await gate.getConflict();
    const approval = await requestApproval(args);
    await gate;
    const decision = await awaitApprovalDecision(args.runId, approval);
    return await recordDecision({ runId: args.runId, node: args.node, approvalId: approval.approvalId, decision });
  } finally {
    gate.dispose();
  }
}
