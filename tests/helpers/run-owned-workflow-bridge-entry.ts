import { lstat, realpath, writeFile } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { WorkflowAcceptanceContext } from "@/contracts/workflow-case-acceptance";
import { MAX_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_BYTES, WorkflowAcceptanceBridgeRequest } from "@/contracts/workflow-acceptance-bridge";
import { MAX_WORKFLOW_RUNTIME_OBSERVATION_REQUEST_BYTES, WorkflowAcceptanceRuntimeObservationRequest,
  WorkflowAcceptanceRuntimeFingerprints, WorkflowAcceptanceRuntimeCoverageEvaluation, WORKFLOW_EXPECTED_FINGERPRINTS_FILE,
  WORKFLOW_RUNTIME_OBSERVATION_REQUEST_FILE, WORKFLOW_RUNTIME_COVERAGE_EVALUATION_FILE } from "@/contracts/workflow-runtime-observation";
import { readOwnedWorkflowJson } from "./read-owned-workflow-json";
import { collectOwnedWorkflowRuntimeFacts, deriveOwnedWorkflowRuntimeFingerprints } from "./collect-owned-workflow-runtime-facts";

const MAX_CONTEXT_BYTES = 8192;
const LEGACY_OPERATIONS = { "observe-empty-request.json": "observe-empty", "observe-request.json": "observe", "finalize-request.json": "finalize" } as const;
function fail(): never { throw new Error("专用入口请求或目录归属未确认，保留资源"); }
function key(file: string) { return process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file); }
function sameContext(left: WorkflowAcceptanceContext, right: WorkflowAcceptanceContext) {
  return Object.entries(left).every(([field, value]) => right[field as keyof WorkflowAcceptanceContext] === value);
}
function environmentContext(environment: NodeJS.ProcessEnv): WorkflowAcceptanceContext {
  const raw = environment.MVP_WORKFLOW_ACCEPTANCE_CONTEXT;
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_CONTEXT_BYTES) fail();
  try { return WorkflowAcceptanceContext.parse(JSON.parse(raw)); } catch { fail(); }
}
function absoluteFile(file: string) {
  if (typeof file !== "string" || file !== file.trim() || !path.isAbsolute(file)
    || /[\x00-\x1f\x7f"<>|?*]/.test(file)) fail();
  const root = path.parse(file).root;
  if (process.platform === "win32" ? !/^[a-z]:[\\/]$/i.test(root) : root !== "/") fail();
  if (file.slice(root.length).split(/[\\/]/).some((part) => !part || part === "." || part === ".." || part.includes(":"))) fail();
}
async function ownedContext(context: WorkflowAcceptanceContext, directory: string) {
  const sdkDirectory = path.join(directory, `sdk-${context.executionDomainId}`);
  if (key(context.sdkDirectory) !== key(sdkDirectory)) fail();
  const snapshots = new Map<string, BigIntStats>();
  for (const file of [directory, sdkDirectory]) {
    for (let current = file; ; current = path.dirname(current)) {
      const stat = await lstat(current, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || key(await realpath(current)) !== key(current)) fail();
      if (!snapshots.has(current)) snapshots.set(current, stat);
      if (path.dirname(current) === current) break;
    }
  }
  for (const file of [path.join(directory, "context.json"), path.join(sdkDirectory, "owner-context.json")]) {
    if (!sameContext(context, WorkflowAcceptanceContext.parse(await readOwnedWorkflowJson(file, MAX_CONTEXT_BYTES)))) fail();
  }
  return async () => {
    for (const [file, before] of snapshots) {
      const current = await lstat(file, { bigint: true });
      const privateDirectory = key(file) === key(directory) || key(file) === key(sdkDirectory);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino
        || privateDirectory && (current.mtimeNs !== before.mtimeNs || current.ctimeNs !== before.ctimeNs || current.nlink !== before.nlink)
        || key(await realpath(file)) !== key(file)) fail();
    }
  };
}

export async function runOwnedWorkflowBridgeEntry(file: string, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  absoluteFile(file);
  const name = path.basename(file), directory = path.dirname(file);
  if (name !== "context.json" && name !== WORKFLOW_RUNTIME_OBSERVATION_REQUEST_FILE && !Object.hasOwn(LEGACY_OPERATIONS, name)) fail();
  const envContext = environmentContext(environment);
  if (name === "context.json") {
    const context = WorkflowAcceptanceContext.parse(await readOwnedWorkflowJson(file, MAX_CONTEXT_BYTES));
    if (!sameContext(context, envContext)) fail();
    const assertUnchanged = await ownedContext(context, directory);
    const fingerprints = WorkflowAcceptanceRuntimeFingerprints.parse(await deriveOwnedWorkflowRuntimeFingerprints());
    await assertUnchanged();
    await writeFile(path.join(directory, WORKFLOW_EXPECTED_FINGERPRINTS_FILE), JSON.stringify(fingerprints), { encoding: "utf8", flag: "wx" });
    return;
  }
  if (name === WORKFLOW_RUNTIME_OBSERVATION_REQUEST_FILE) {
    const raw = await readOwnedWorkflowJson(file, MAX_WORKFLOW_RUNTIME_OBSERVATION_REQUEST_BYTES);
    const request = WorkflowAcceptanceRuntimeObservationRequest.parse(raw);
    if (key(request.caseDirectory) !== key(directory) || !sameContext(request.context, envContext)) fail();
    const assertUnchanged = await ownedContext(request.context, directory);
    const evaluation = WorkflowAcceptanceRuntimeCoverageEvaluation.parse(await collectOwnedWorkflowRuntimeFacts(raw));
    await assertUnchanged();
    await writeFile(path.join(directory, WORKFLOW_RUNTIME_COVERAGE_EVALUATION_FILE), JSON.stringify(evaluation), { encoding: "utf8", flag: "wx" });
    if (evaluation.status !== "consistent") throw new Error("完整运行证据未确认，已保留失败判定，不允许清理");
    return;
  }
  const request = WorkflowAcceptanceBridgeRequest.parse(await readOwnedWorkflowJson(file, MAX_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_BYTES));
  if (request.operation !== LEGACY_OPERATIONS[name as keyof typeof LEGACY_OPERATIONS]
    || key(request.caseDirectory) !== key(directory) || !sameContext(request.context, envContext)) fail();
  const { runWorkflowAcceptanceBridge } = await import("../../scripts/workflow-acceptance-case-bridge");
  const { verifyOwnedWorkflowControlPlane } = await import("./verify-owned-workflow-control-plane");
  await runWorkflowAcceptanceBridge(request, (current, directUri) => verifyOwnedWorkflowControlPlane(current, directUri));
}
