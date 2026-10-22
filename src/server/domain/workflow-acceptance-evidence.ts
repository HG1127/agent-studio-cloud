import {
  WorkflowAcceptanceContext, WorkflowAcceptanceChildReport, WorkflowAcceptanceParentObservation,
  WorkflowAcceptanceEvidenceEvaluation, type WorkflowAcceptanceFailureReason,
} from "@/contracts/workflow-case-acceptance";

export function evaluateWorkflowAcceptanceEvidence(rawContext: unknown, rawChild: unknown, rawObservation: unknown): WorkflowAcceptanceEvidenceEvaluation {
  // 父观察必须来自自有控制器；纯判定不执行 OS、SQL 或清理操作。
  const context = WorkflowAcceptanceContext.safeParse(rawContext);
  const child = WorkflowAcceptanceChildReport.safeParse(rawChild);
  const observation = WorkflowAcceptanceParentObservation.safeParse(rawObservation);
  const failures = new Set<WorkflowAcceptanceFailureReason>();
  if (!context.success) failures.add("invalid-context");
  if (!child.success) failures.add("invalid-child-report");
  if (!observation.success) failures.add("invalid-parent-observation");
  if (context.success && child.success && observation.success) {
    const expected = context.data, reported = child.data, observed = observation.data;
    if (Object.entries(expected).some(([key, value]) => reported.context[key as keyof WorkflowAcceptanceContext] !== value)
      || observed.executionDomainId !== expected.executionDomainId) failures.add("context-mismatch");
    if (reported.businessStatus !== "passed") failures.add("business-unconfirmed");
    if (!observed.allRealmReceiptsCollected || reported.realms.length === 0
      || reported.realms.every((realm) => realm.pools.poolIds.length === 0)
      || reported.realms.some((realm) => realm.pools.state !== "callbacks_completed")) failures.add("pool-close-unconfirmed");
    if (!observed.sourceMatched) failures.add("source-unconfirmed");
    if (!observed.launchOwnershipVerified || observed.termination !== "natural" || observed.exitCode !== 0
      || !observed.processObservationComplete || observed.remainingOwnedProcesses !== 0) failures.add("process-exit-unconfirmed");
    if (!observed.ownedBranchVerified || observed.databaseBranchId !== expected.databaseBranchId
      || observed.applicationName !== expected.applicationName || !observed.databaseObservationComplete
      || !observed.databaseSnapshotFresh || observed.databaseConnections !== 0 || observed.activeSql !== 0) failures.add("database-stop-unconfirmed");
    if (!observed.sdkDirectoryOwnershipVerified) failures.add("sdk-directory-unowned");
  }
  return WorkflowAcceptanceEvidenceEvaluation.parse({
    outcome: failures.size === 0 ? "passed" : "failed", cleanupPermitted: failures.size === 0, failures: [...failures],
  });
}
