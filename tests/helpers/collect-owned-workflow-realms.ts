import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  WorkflowAcceptanceContext, WorkflowAcceptanceRealmRegistration, WorkflowAcceptanceRealmFinalReceipt,
  type WorkflowAcceptanceRealmReceipt, MAX_WORKFLOW_ACCEPTANCE_REALMS, MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES,
} from "@/contracts/workflow-case-acceptance";
import { readOwnedWorkflowJson } from "./read-owned-workflow-json";

function fail(): never { throw new Error("执行空间登记或关闭证据不完整，保留资源"); }
function sameContext(left: WorkflowAcceptanceContext, right: WorkflowAcceptanceContext): boolean {
  return Object.entries(left).every(([key, value]) => right[key as keyof WorkflowAcceptanceContext] === value);
}

export function validateCollectedRealmReceipts(rawContext: unknown, rawRegistrations: readonly unknown[], rawFinals: readonly unknown[], ownedProcessIds: ReadonlySet<number>): WorkflowAcceptanceRealmReceipt[] {
  const context = WorkflowAcceptanceContext.parse(rawContext);
  if (rawRegistrations.length === 0 || rawRegistrations.length > MAX_WORKFLOW_ACCEPTANCE_REALMS
    || rawRegistrations.length !== rawFinals.length) fail();
  const registrations = new Map<string, WorkflowAcceptanceRealmRegistration>();
  for (const raw of rawRegistrations) {
    const registration = WorkflowAcceptanceRealmRegistration.parse(raw);
    if (!sameContext(context, registration.context) || !ownedProcessIds.has(registration.processId)
      || registrations.has(registration.realmId)) fail();
    registrations.set(registration.realmId, registration);
  }
  const seen = new Set<string>(), pools = new Set<string>();
  const receipts: WorkflowAcceptanceRealmReceipt[] = [];
  for (const raw of rawFinals) {
    const final = WorkflowAcceptanceRealmFinalReceipt.parse(raw);
    const receipt = final.receipt, registration = registrations.get(receipt.realmId);
    if (!sameContext(context, final.context) || !registration || seen.has(receipt.realmId)
      || registration.processId !== receipt.processId || registration.threadId !== receipt.threadId
      || receipt.pools.state !== "callbacks_completed") fail();
    for (const poolId of receipt.pools.poolIds) { if (pools.has(poolId)) fail(); pools.add(poolId); }
    seen.add(receipt.realmId); receipts.push(receipt);
  }
  if (pools.size === 0) fail();
  return receipts;
}

export async function collectOwnedWorkflowRealms(rawContext: unknown, ownedProcessIds: ReadonlySet<number>): Promise<WorkflowAcceptanceRealmReceipt[]> {
  const context = WorkflowAcceptanceContext.parse(rawContext);
  const root = context.sdkDirectory, directory = path.join(root, "realms");
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    if (path.dirname(current) === current) break;
  }
  if (path.resolve(await realpath(directory)).toLowerCase() !== path.resolve(directory).toLowerCase()) fail();
  let bytes = 0;
  async function read(file: string): Promise<unknown> {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (bytes += stat.size) > MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES) fail();
    return readOwnedWorkflowJson(file, Math.min(MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES, Number(stat.size)));
  }
  if (!sameContext(context, WorkflowAcceptanceContext.parse(await read(path.join(root, "owner-context.json"))))) fail();
  const files = await readdir(directory);
  if (files.length === 0 || files.length > MAX_WORKFLOW_ACCEPTANCE_REALMS * 2) fail();
  const registrations: unknown[] = [], finals: unknown[] = [];
  for (const file of files.sort()) {
    const match = /^([a-f0-9-]{36})\.(registered|final)\.json$/.exec(file);
    if (!match) fail();
    const raw = await read(path.join(directory, file));
    if (match[2] === "registered") {
      const registration = WorkflowAcceptanceRealmRegistration.parse(raw);
      if (registration.realmId !== match[1]) fail();
      registrations.push(registration);
    } else {
      const final = WorkflowAcceptanceRealmFinalReceipt.parse(raw);
      if (final.receipt.realmId !== match[1]) fail();
      finals.push(final);
    }
  }
  // This validates only registered realms. Complete VM instrumentation and thread ownership remain independent parent evidence.
  return validateCollectedRealmReceipts(context, registrations, finals, ownedProcessIds);
}
