import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { types } from "node:util";
import { WorkflowAcceptanceContext, MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES } from "@/contracts/workflow-case-acceptance";
import { MAX_WORKFLOW_ACCEPTANCE_PROCESS_INVENTORY_BYTES } from "@/contracts/workflow-process-inventory";
import { WorkflowAcceptanceOwnedBranchProvenance, MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES } from "@/contracts/workflow-acceptance-bridge";
import { WorkflowAcceptanceRuntimeInventory, MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES } from "@/contracts/workflow-runtime-inventory";
import { WorkflowAcceptanceRuntimeObservationRequest, WorkflowAcceptanceRuntimeCoverageEvaluation, WorkflowAcceptanceRuntimeFingerprints,
  WORKFLOW_BUSINESS_PROCESS_INVENTORY_FILE, WORKFLOW_BUSINESS_CHILD_REPORT_FILE, WORKFLOW_RUNTIME_INVENTORY_DIRECTORY,
  type WorkflowAcceptanceRuntimeCoverageFailure } from "@/contracts/workflow-runtime-observation";
import { evaluateWorkflowRuntimeCoverage } from "@/server/domain/evaluate-workflow-runtime-coverage";
import { readOwnedWorkflowJsonWithHash } from "./read-owned-workflow-json";

const PROJECT = path.resolve(import.meta.dirname, "../..");
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_RUNTIME_TOTAL_BYTES = 32 * 1024 * 1024;
const ADAPTERS = ["owned-workflow-preload.mjs", "owned-workflow-instrumentation.mjs", "owned-workflow-world-adapter.mjs", "owned-workflow-build-services.mjs"];
const INVENTORY_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/;
type Snapshot = fs.BigIntStats;

class UnconfirmedFacts extends Error {
  constructor(readonly failure: WorkflowAcceptanceRuntimeCoverageFailure) { super("原始运行证据未确认，保留资源"); }
}
function reject(failure: WorkflowAcceptanceRuntimeCoverageFailure): never { throw new UnconfirmedFacts(failure); }
function unconfirmed(failure: WorkflowAcceptanceRuntimeCoverageFailure): WorkflowAcceptanceRuntimeCoverageEvaluation {
  return WorkflowAcceptanceRuntimeCoverageEvaluation.parse({ version: 2, status: "unconfirmed", cleanupPermitted: false,
    failures: [failure], counts: { processes: null, nodeProcesses: null, launches: null, realms: null, pools: null } });
}
function key(file: string): string { return process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file); }
function inside(file: string, directory: string): boolean { return key(file).startsWith(key(directory) + path.sep); }
function sameIdentity(left: Snapshot, right: Snapshot): boolean { return left.dev === right.dev && left.ino === right.ino; }
function sameFile(left: Snapshot, right: Snapshot): boolean {
  return sameIdentity(left, right) && left.isFile() && right.isFile() && !right.isSymbolicLink()
    && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.nlink === right.nlink;
}
function sameRecord(left: object, right: object): boolean {
  const entries = Object.entries(left);
  return entries.length === Object.keys(right).length && entries.every(([name, value]) => (right as Record<string, unknown>)[name] === value);
}
function passiveRequest(value: unknown): void {
  const seen = new Set<object>(); let entries = 0;
  function visit(item: unknown, depth: number) {
    if (++entries > 4096 || depth > 20) reject("invalid-request");
    if (!item || typeof item !== "object") return;
    if (types.isProxy(item) || seen.has(item)) reject("invalid-request");
    const prototype: unknown = Object.getPrototypeOf(item);
    const array = Array.isArray(item);
    if (prototype !== null) {
      if (typeof prototype !== "object" || types.isProxy(prototype)
        || (array ? !Array.isArray(prototype) : Object.getPrototypeOf(prototype) !== null)) reject("invalid-request");
      const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
      if (!constructor || !Object.hasOwn(constructor, "value") || typeof constructor.value !== "function"
        || types.isProxy(constructor.value)) reject("invalid-request");
      const ownedPrototype = Object.getOwnPropertyDescriptor(constructor.value, "prototype");
      if (!ownedPrototype || !Object.hasOwn(ownedPrototype, "value") || ownedPrototype.value !== prototype
        || Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(array ? Array : Object)) reject("invalid-request");
    } else if (array) reject("invalid-request");
    seen.add(item);
    for (const name of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, name);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) reject("invalid-request");
      visit(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
}
function noActivatedProfile(): void {
  if (process.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE !== undefined
    || process.execArgv.some((argument) => argument === "--import" || argument.startsWith("--import="))) reject("source-fingerprint-mismatch");
}

function createFingerprintSession() {
  const sources = new Map<string, Snapshot>();
  function privateSource(file: string) {
    if (typeof file !== "string" || !path.isAbsolute(file) || !inside(file, PROJECT)) reject("source-fingerprint-mismatch");
    for (let current = path.dirname(file); ; current = path.dirname(current)) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || key(fs.realpathSync(current)) !== key(current)) reject("source-fingerprint-mismatch");
      if (path.dirname(current) === current) break;
    }
    if (key(fs.realpathSync(file)) !== key(file)) reject("source-fingerprint-mismatch");
  }
  function sourceBytes(file: string): Buffer {
    privateSource(file);
    const before = fs.lstatSync(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size < BigInt(1) || before.size > BigInt(MAX_SOURCE_BYTES)) reject("source-fingerprint-mismatch");
    const previous = sources.get(file);
    if (previous && !sameFile(previous, before)) reject("source-fingerprint-mismatch");
    const descriptor = fs.openSync(file, "r");
    try {
      if (!sameFile(before, fs.fstatSync(descriptor, { bigint: true }))) reject("source-fingerprint-mismatch");
      const bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
      while (length < bytes.length) {
        const read = fs.readSync(descriptor, bytes, length, bytes.length - length, length);
        if (read === 0) break;
        length += read;
      }
      if (BigInt(length) !== before.size || !sameFile(before, fs.fstatSync(descriptor, { bigint: true }))
        || !sameFile(before, fs.lstatSync(file, { bigint: true }))) reject("source-fingerprint-mismatch");
      sources.set(file, before);
      return bytes.subarray(0, length);
    } finally { fs.closeSync(descriptor); }
  }
  async function derive(): Promise<WorkflowAcceptanceRuntimeFingerprints> {
    noActivatedProfile();
    const adapterLines = ADAPTERS.map((name) => `${name}:${createHash("sha256").update(sourceBytes(path.join(PROJECT, "tests/helpers", name))).digest("hex")}`);
    const require = createRequire(pathToFileURL(path.join(PROJECT, "package.json")));
    const resolve = (specifier: string, importer?: string): string => {
      const resolved = fs.realpathSync((importer ? createRequire(pathToFileURL(importer)) : require).resolve(specifier));
      if (!inside(resolved, path.join(PROJECT, "node_modules"))) reject("source-fingerprint-mismatch");
      return resolved;
    };
    const io = { lstatSync: (file: string) => { privateSource(file); return fs.lstatSync(file); },
      realpathSync: (file: string) => { privateSource(file); return fs.realpathSync(file); }, readFileSync: sourceBytes };
    // This collector is only for the unprofiled observation bridge; imports must never bootstrap a runtime.
    const { buildOwnedSdkProfile } = await import("./owned-workflow-preload.mjs");
    const { buildOwnedNativeBuildProfile } = await import("./owned-workflow-build-services.mjs");
    noActivatedProfile();
    const profile = buildOwnedSdkProfile(resolve, io), build = buildOwnedNativeBuildProfile(resolve, io);
    return { adapterFingerprint: createHash("sha256").update(adapterLines.join("\n")).digest("hex"),
      sdkFactoryFingerprint: createHash("sha256").update(`${profile.sdkFactoryFingerprint}\n${build.fingerprint}`).digest("hex") };
  }
  function assertUnchanged() {
    for (const [file, before] of sources) {
      privateSource(file);
      if (!sameFile(before, fs.lstatSync(file, { bigint: true }))) reject("source-fingerprint-mismatch");
    }
  }
  return { derive, assertUnchanged };
}

export async function deriveOwnedWorkflowRuntimeFingerprints(): Promise<WorkflowAcceptanceRuntimeFingerprints> {
  const session = createFingerprintSession();
  const fingerprints = await session.derive();
  session.assertUnchanged();
  return WorkflowAcceptanceRuntimeFingerprints.parse(fingerprints);
}

export async function collectOwnedWorkflowRuntimeFacts(rawRequest: unknown): Promise<WorkflowAcceptanceRuntimeCoverageEvaluation> {
  const files = new Map<string, Snapshot>(), directories = new Map<string, Snapshot>();
  const fingerprintSession = createFingerprintSession();
  let stage: WorkflowAcceptanceRuntimeCoverageFailure = "invalid-request";
  try {
    passiveRequest(rawRequest);
    const request = WorkflowAcceptanceRuntimeObservationRequest.parse(rawRequest);
    const context = request.context, caseDirectory = path.resolve(request.caseDirectory), sdkDirectory = path.join(caseDirectory, `sdk-${context.executionDomainId}`);
    if (key(context.sdkDirectory) !== key(sdkDirectory)) reject("context-mismatch");
    stage = "context-mismatch";
    async function directory(file: string) {
      for (let current = file; ; current = path.dirname(current)) {
        const stat = await lstat(current, { bigint: true });
        if (!stat.isDirectory() || stat.isSymbolicLink() || key(await realpath(current)) !== key(current)) reject(stage);
        if (current === file) directories.set(file, stat);
        if (path.dirname(current) === current) break;
      }
    }
    async function read(file: string, maximum: number, expectedHash?: string) {
      const before = await lstat(file, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== BigInt(1) || before.size < BigInt(1) || before.size > BigInt(maximum)) reject(stage);
      const value = await readOwnedWorkflowJsonWithHash(file, maximum);
      if (!sameFile(before, await lstat(file, { bigint: true })) || expectedHash !== undefined && value.sha256 !== expectedHash) reject(stage);
      files.set(file, before);
      return value.value;
    }
    await directory(caseDirectory); await directory(sdkDirectory);
    for (const file of [path.join(caseDirectory, "context.json"), path.join(sdkDirectory, "owner-context.json")]) {
      if (!sameRecord(WorkflowAcceptanceContext.parse(await read(file, 8192)), context)) reject("context-mismatch");
    }
    if (!sameRecord(WorkflowAcceptanceOwnedBranchProvenance.parse(await read(path.join(caseDirectory, "creation-provenance.json"), 16 * 1024)), request.provenance)) reject("context-mismatch");

    stage = "source-fingerprint-mismatch";
    if (!sameRecord(await fingerprintSession.derive(), request.expectedFingerprints)) reject(stage);
    stage = "invalid-process-inventory";
    const processInventory = await read(path.join(caseDirectory, WORKFLOW_BUSINESS_PROCESS_INVENTORY_FILE), MAX_WORKFLOW_ACCEPTANCE_PROCESS_INVENTORY_BYTES, request.processInventoryRef.sha256);
    stage = "invalid-child-report";
    const childReport = await read(path.join(caseDirectory, WORKFLOW_BUSINESS_CHILD_REPORT_FILE), MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES, request.childReportRef.sha256);
    stage = "invalid-runtime-inventory";
    const runtimeDirectory = path.join(sdkDirectory, WORKFLOW_RUNTIME_INVENTORY_DIRECTORY);
    await directory(runtimeDirectory);
    async function enumeration() {
      const names: string[] = [];
      const handle = await opendir(runtimeDirectory);
      for await (const entry of handle) {
        if (names.length >= MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES || !entry.isFile() || entry.isSymbolicLink() || !INVENTORY_NAME.test(entry.name)) reject("invalid-runtime-inventory");
        names.push(entry.name);
      }
      return names.sort();
    }
    const names = await enumeration(), expectedNames = request.runtimeInventoryRefs.map((reference) => `${reference.launchId}.json`).sort();
    if (names.length !== expectedNames.length || names.some((name, index) => name !== expectedNames[index])) reject("launch-set-mismatch");
    const refs = new Map(request.runtimeInventoryRefs.map((reference) => [reference.launchId, reference.sha256]));
    const inventories: unknown[] = []; let runtimeBytes = BigInt(0);
    for (const name of names) {
      const file = path.join(runtimeDirectory, name), launchId = name.slice(0, -5);
      const stat = await lstat(file, { bigint: true }); runtimeBytes += stat.size;
      if (runtimeBytes > BigInt(MAX_RUNTIME_TOTAL_BYTES)) reject("invalid-runtime-inventory");
      const inventory = await read(file, MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES, refs.get(launchId));
      const parsed = WorkflowAcceptanceRuntimeInventory.parse(inventory);
      if (parsed.launch.launchId !== launchId) reject("launch-set-mismatch");
      inventories.push(inventory);
    }
    const after = await enumeration();
    if (names.length !== after.length || names.some((name, index) => name !== after[index])) reject("launch-set-mismatch");
    stage = "source-fingerprint-mismatch";
    if (!sameRecord(await fingerprintSession.derive(), request.expectedFingerprints)) reject(stage);
    fingerprintSession.assertUnchanged();
    for (const [file, before] of files) if (!sameFile(before, await lstat(file, { bigint: true }))) reject("runtime-lifecycle-unconfirmed");
    for (const [file, before] of directories) {
      const current = await lstat(file, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(before, current)
        || current.mtimeNs !== before.mtimeNs || current.ctimeNs !== before.ctimeNs || current.nlink !== before.nlink
        || key(await realpath(file)) !== key(file)) reject("runtime-lifecycle-unconfirmed");
    }
    return evaluateWorkflowRuntimeCoverage(request, processInventory, childReport, inventories);
  } catch (error) { return unconfirmed(error instanceof UnconfirmedFacts ? error.failure : stage); }
}
