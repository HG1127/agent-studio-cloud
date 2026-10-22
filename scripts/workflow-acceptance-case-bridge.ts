import postgres from "postgres";
import { lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkflowAcceptanceContext, WorkflowAcceptanceDatabaseObservation } from "../src/contracts/workflow-case-acceptance";
import { WorkflowAcceptanceChildReport, WorkflowAcceptanceCaseResult } from "../src/contracts/workflow-case-acceptance";
import { WorkflowAcceptanceBridgeRequest, WorkflowAcceptanceObservedRecord, WorkflowAcceptanceOwnedBranchProvenance,
  WorkflowAcceptanceEmptyDatabaseObservation, MAX_WORKFLOW_ACCEPTANCE_OBSERVED_RECORD_BYTES } from "../src/contracts/workflow-acceptance-bridge";
import { evaluateWorkflowAcceptanceEvidence } from "../src/server/domain/workflow-acceptance-evidence";
import { observeWorkflowAcceptanceDatabase, observeUnmigratedUserRelationCount } from "../src/db/queries/workflow-acceptance-observation";
import { collectOwnedWorkflowRealms } from "../tests/helpers/collect-owned-workflow-realms";
import { readOwnedWorkflowJson } from "../tests/helpers/read-owned-workflow-json";

export async function observeClosedOwnedCase(rawContext: unknown, ownedProcessIds: ReadonlySet<number>, verifyOfficialTarget: (context: WorkflowAcceptanceContext, directUri: string) => Promise<void>): Promise<WorkflowAcceptanceDatabaseObservation> {
  const context = WorkflowAcceptanceContext.parse(rawContext);
  const uri = process.env.MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED;
  if (!uri || uri !== uri.trim() || /[\x00-\x1f\x7f]/.test(uri)) throw new Error("专用直接连接无效");
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new Error("专用直接连接无效"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.pathname !== "/ci_test"
    || !parsed.hostname.endsWith(".neon.tech") || /pooler|pgbouncer/i.test(parsed.hostname)
    || !parsed.username || parsed.hash || [...parsed.searchParams.keys()].some((key) => !["sslmode", "channel_binding"].includes(key))) {
    throw new Error("拒绝非专用直接验收目标");
  }
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || process.env.MODEL_MOCK !== "1") throw new Error("隔离执行模式未确认");
  await verifyOfficialTarget(context, uri);
  await collectOwnedWorkflowRealms(context, ownedProcessIds);
  const client = postgres(uri, { max: 1, ssl: "require", connection: { application_name: "mvp_observer_" + context.executionDomainId.replaceAll("-", "") } });
  let observation: WorkflowAcceptanceDatabaseObservation;
  try {
    observation = await observeWorkflowAcceptanceDatabase(context, async (query, ...values) => client(query, ...values));
  } finally {
    // The observer is a separate direct client, not a business pool; native end must acknowledge without force.
    try { await client.end(); }
    catch { throw new Error("父观测连接关闭未确认，保留资源"); }
  }
  return observation;
}

export async function observeEmptyOwnedDatabase(rawContext: unknown, rawProvenance: unknown,
  verifyOfficialTarget: (context: WorkflowAcceptanceContext, provenance: WorkflowAcceptanceOwnedBranchProvenance, directUri: string) => Promise<void>): Promise<WorkflowAcceptanceEmptyDatabaseObservation> {
  const context = WorkflowAcceptanceContext.parse(rawContext), provenance = WorkflowAcceptanceOwnedBranchProvenance.parse(rawProvenance);
  for (const key of ["databaseBranchId", "executionDomainId", "batchId", "sourceCommit", "sourceFingerprint"] as const) {
    if (provenance[key] !== context[key]) throw new Error("迁移前空库与本次执行域不一致");
  }
  const uri = process.env.MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED;
  if (!uri || uri !== uri.trim() || /[\x00-\x1f\x7f]/.test(uri)) throw new Error("专用直接连接无效");
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new Error("专用直接连接无效"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.hostname !== provenance.endpointHost
    || parsed.pathname !== "/ci_test" || !parsed.username || parsed.hash
    || [...parsed.searchParams.keys()].some((key) => !["sslmode", "channel_binding"].includes(key))
    || process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || process.env.MODEL_MOCK !== "1") throw new Error("迁移前隔离目标未确认");
  await verifyOfficialTarget(context, provenance, uri);
  const client = postgres(uri, { max: 1, ssl: "require", connection: { application_name: "mvp_observer_" + context.executionDomainId.replaceAll("-", "") } });
  let userRelationCount: number | null = null;
  let checkedAt: string;
  try {
    userRelationCount = await observeUnmigratedUserRelationCount(async (query, ...values) => client(query, ...values));
    checkedAt = new Date().toISOString();
  }
  finally {
    try { await client.end(); }
    catch { throw new Error("迁移前观测连接关闭未确认，保留资源"); }
  }
  return WorkflowAcceptanceEmptyDatabaseObservation.parse({ version: 1, databaseBranchId: context.databaseBranchId,
    endpointId: provenance.endpointId, databaseName: "ci_test", checkedAt, userRelationCount,
    observationStatus: userRelationCount === null ? "unknown" : "observed" });
}

async function readOwnedRecord(file: string): Promise<unknown> {
  return readOwnedWorkflowJson(file, MAX_WORKFLOW_ACCEPTANCE_OBSERVED_RECORD_BYTES);
}

export async function runWorkflowAcceptanceBridge(rawRequest: unknown, verifyControlPlane: (request: WorkflowAcceptanceBridgeRequest, directUri: string | null) => Promise<void>): Promise<void> {
  const request = WorkflowAcceptanceBridgeRequest.parse(rawRequest);
  const directory = request.caseDirectory;
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("案例目录归属未确认");
    if (path.dirname(current) === current) break;
  }
  const owner = WorkflowAcceptanceContext.parse(await readOwnedRecord(path.join(directory, "context.json")));
  if (JSON.stringify(owner) !== JSON.stringify(request.context)) throw new Error("桥接上下文与父目录不一致");
  if (request.operation === "observe-empty") {
    const observation = await observeEmptyOwnedDatabase(request.context, request.provenance, async (_context, _provenance, uri) => {
      await verifyControlPlane(request, uri);
    });
    await writeFile(path.join(directory, "empty-database-observation.json"), JSON.stringify(observation), { encoding: "utf8", flag: "wx" });
    if (observation.observationStatus !== "observed" || observation.userRelationCount !== 0) {
      throw new Error("迁移前空库未确认，保留原观察结果并禁止迁移");
    }
    return;
  }
  if (request.operation === "finalize") {
    await verifyControlPlane(request, null);
    const observed = WorkflowAcceptanceObservedRecord.parse(await readOwnedRecord(path.join(directory, "observed-record.json")));
    if (JSON.stringify(observed.context) !== JSON.stringify(request.context)
      || JSON.stringify(observed.provenance) !== JSON.stringify(request.provenance) || observed.caseDirectory !== directory) throw new Error("最终结果与原实际观测不一致");
    const evaluation = evaluateWorkflowAcceptanceEvidence(request.context, observed.child, observed.observation);
    const result = WorkflowAcceptanceCaseResult.parse({ version: 1, context: request.context,
      child: observed.child, observation: observed.observation, evaluation, cleanup: request.cleanup });
    await writeFile(path.join(directory, "case-result.json"), JSON.stringify(result), { encoding: "utf8", flag: "wx" });
    if (evaluation.outcome !== "passed" || result.cleanup.status !== "deleted-and-verified") throw new Error("真实执行或清理未完成，保留失败回执");
    return;
  }
  const os = request.processObservation;
  if (!os.sourceMatched || !os.launchOwnershipVerified || os.termination !== "natural" || os.exitCode !== 0
    || !os.processObservationComplete || os.remainingOwnedProcesses !== 0 || !os.sdkDirectoryOwnershipVerified) throw new Error("自然执行域退出未确认，禁止数据库观测");
  const originalChild = WorkflowAcceptanceChildReport.parse(await readOwnedRecord(path.join(directory, "child-result.json")));
  if (JSON.stringify(originalChild.context) !== JSON.stringify(request.context)) throw new Error("子案例上下文不一致");
  const ids = new Set(request.ownedProcessIds);
  const realms = await collectOwnedWorkflowRealms(request.context, ids);
  const child = WorkflowAcceptanceChildReport.parse({ ...originalChild, realms });
  const databaseObservation = await observeClosedOwnedCase(request.context, ids, async (_context, uri) => {
    if (new URL(uri).hostname !== request.provenance.endpointHost) throw new Error("专用直接连接与创建端点不一致");
    await verifyControlPlane(request, uri);
  });
  // File pairing is not complete VM coverage. Keep the derived coverage flag false until the controller proves instrumentation completeness.
  const observation = { ...os, allRealmReceiptsCollected: false, ownedBranchVerified: true,
    databaseObservationComplete: databaseObservation.observationStatus === "observed", databaseSnapshotFresh: false,
    databaseConnections: databaseObservation.databaseConnections, activeSql: databaseObservation.activeSql };
  const observed = WorkflowAcceptanceObservedRecord.parse({ version: 1, context: request.context, caseDirectory: directory,
    provenance: request.provenance, ownedProcessIds: request.ownedProcessIds, child, observation, databaseObservation,
    observedAt: new Date().toISOString() });
  await writeFile(path.join(directory, "observed-record.json"), JSON.stringify(observed), { encoding: "utf8", flag: "wx" });
}
