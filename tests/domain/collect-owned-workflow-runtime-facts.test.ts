import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";
import { WorkflowAcceptanceRuntimeCoverageEvaluation, WorkflowAcceptanceRuntimeFingerprints, type WorkflowAcceptanceRuntimeObservationRequest,
  type WorkflowAcceptanceRuntimeCoverageFailure } from "@/contracts/workflow-runtime-observation";
import type { WorkflowAcceptanceRuntimeInventory } from "@/contracts/workflow-runtime-inventory";
import type { WorkflowAcceptanceProcessInventory } from "@/contracts/workflow-process-inventory";
import type { WorkflowAcceptanceChildReport } from "@/contracts/workflow-case-acceptance";

const dependencies = vi.hoisted(() => ({
  lstat: vi.fn(), opendir: vi.fn(), realpath: vi.fn(),
  read: vi.fn(), sdk: vi.fn(), native: vi.fn(), createRequire: vi.fn(),
  lstatSync: vi.fn(), realpathSync: vi.fn(), openSync: vi.fn(), fstatSync: vi.fn(), readSync: vi.fn(), closeSync: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ lstat: dependencies.lstat, opendir: dependencies.opendir, realpath: dependencies.realpath }));
vi.mock("node:fs", () => ({ lstatSync: dependencies.lstatSync, realpathSync: dependencies.realpathSync,
  openSync: dependencies.openSync, fstatSync: dependencies.fstatSync, readSync: dependencies.readSync, closeSync: dependencies.closeSync }));
vi.mock("node:module", () => ({ createRequire: dependencies.createRequire }));
vi.mock("../helpers/read-owned-workflow-json", () => ({ readOwnedWorkflowJsonWithHash: dependencies.read }));
vi.mock("../helpers/owned-workflow-preload.mjs", () => ({ buildOwnedSdkProfile: dependencies.sdk }));
vi.mock("../helpers/owned-workflow-build-services.mjs", () => ({ buildOwnedNativeBuildProfile: dependencies.native }));

import { collectOwnedWorkflowRuntimeFacts, deriveOwnedWorkflowRuntimeFingerprints } from "../helpers/collect-owned-workflow-runtime-facts";

const PROJECT = path.resolve(import.meta.dirname, "../..");
const adapterNames = ["owned-workflow-preload.mjs", "owned-workflow-instrumentation.mjs", "owned-workflow-world-adapter.mjs", "owned-workflow-build-services.mjs"];
const sourcePath = (name: string) => path.join(PROJECT, "tests/helpers", name);
const sdkSource = path.join(PROJECT, "node_modules/mock-sdk/runtime.js");
const nativeSource = path.join(PROJECT, "node_modules/mock-native/esbuild.exe");
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const id = (number: number, group = 1) => `${number.toString(16).padStart(8, "0")}-0000-4000-8000-${group.toString(16).padStart(12, "0")}`;
const at = (second: number) => `2026-10-14T10:00:${String(second).padStart(2, "0")}.000Z`;
type Entry = { bytes: Buffer; directory: boolean; ino: number; time: number; links: number; symbolic: boolean; reportedSize?: number };
type ProfileIo = Readonly<{ lstatSync: (file: string) => unknown; realpathSync: (file: string) => string; readFileSync: (file: string) => Buffer }>;
const table = new Map<string, Entry>(), descriptors = new Map<number, Entry>(), statCalls = new Map<string, number>();
let nextDescriptor = 10, nextIno = 1, enumerationCount = 0;
let onEnumeration: ((count: number) => void) | undefined;
let onStat: ((file: string, count: number) => void) | undefined;
let onRead: ((file: string) => void) | undefined;
let onProfile: ((kind: "sdk" | "native", call: number) => void) | undefined;
let profileCalls = { sdk: 0, native: 0 };
let originalArguments: string[], originalProfile: string | undefined;
const fileKey = (file: string) => path.resolve(file);
function addDirectory(file: string) {
  for (let current = fileKey(file); ; current = path.dirname(current)) {
    if (!table.has(current)) table.set(current, { bytes: Buffer.alloc(0), directory: true, ino: nextIno++, time: 1, links: 1, symbolic: false });
    if (path.dirname(current) === current) break;
  }
}
function putBytes(file: string, bytes: Buffer) {
  addDirectory(path.dirname(file));
  table.set(fileKey(file), { bytes, directory: false, ino: nextIno++, time: 1, links: 1, symbolic: false });
}
function entry(file: string): Entry {
  const value = table.get(fileKey(file));
  if (!value) throw new Error("模拟文件不存在");
  return value;
}
function snapshot(value: Entry, bigint = false) {
  const integer = (number: number) => bigint ? BigInt(number) : number;
  return { dev: integer(1), ino: integer(value.ino), size: integer(value.reportedSize ?? value.bytes.length),
    mtimeNs: integer(value.time), ctimeNs: integer(value.time), nlink: integer(value.links),
    isFile: () => !value.directory, isDirectory: () => value.directory, isSymbolicLink: () => value.symbolic };
}
function stat(file: string, options?: { bigint?: boolean }) {
  const key = fileKey(file), count = (statCalls.get(key) ?? 0) + 1;
  statCalls.set(key, count); onStat?.(key, count);
  return snapshot(entry(key), options?.bigint);
}

beforeEach(() => {
  for (const dependency of Object.values(dependencies)) dependency.mockReset();
  table.clear(); descriptors.clear(); statCalls.clear();
  nextDescriptor = 10; nextIno = 1; enumerationCount = 0; profileCalls = { sdk: 0, native: 0 };
  onEnumeration = undefined; onStat = undefined; onRead = undefined; onProfile = undefined;
  originalArguments = [...process.execArgv]; originalProfile = process.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE;
  process.execArgv.splice(0); delete process.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE;
  dependencies.lstat.mockImplementation(async (file: string, options?: { bigint?: boolean }) => stat(file, options));
  dependencies.realpath.mockImplementation(async (file: string) => fileKey(file));
  dependencies.lstatSync.mockImplementation(stat);
  dependencies.realpathSync.mockImplementation(fileKey);
  dependencies.openSync.mockImplementation((file: string) => { const descriptor = nextDescriptor++; descriptors.set(descriptor, entry(file)); return descriptor; });
  dependencies.fstatSync.mockImplementation((descriptor: number) => {
    const value = descriptors.get(descriptor); if (!value) throw new Error("模拟句柄不存在"); return snapshot(value, true);
  });
  dependencies.readSync.mockImplementation((descriptor: number, buffer: Buffer, offset: number, length: number, position: number) => {
    const value = descriptors.get(descriptor); if (!value) throw new Error("模拟句柄不存在");
    return value.bytes.copy(buffer, offset, position, Math.min(position + length, value.bytes.length));
  });
  dependencies.closeSync.mockImplementation((descriptor: number) => { descriptors.delete(descriptor); });
  // 模拟 reader 也只按文件原始字节计算 SHA，不借请求值；真实 FD reader 集成仍需独立执行。
  dependencies.read.mockImplementation(async (file: string, maximum: number) => {
    onRead?.(fileKey(file)); const bytes = entry(file).bytes;
    if (bytes.length > maximum) throw new Error("模拟原始文件超限");
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), sha256: sha(bytes) };
  });
  dependencies.createRequire.mockImplementation(() => ({ resolve: (specifier: string) => specifier === "mock-native" ? nativeSource : sdkSource }));
  dependencies.sdk.mockImplementation((resolve: (name: string) => string, io: ProfileIo) => {
    onProfile?.("sdk", ++profileCalls.sdk);
    const file = resolve("mock-sdk"); io.lstatSync(file); io.realpathSync(file);
    return { sdkFactoryFingerprint: sha(io.readFileSync(file)) };
  });
  dependencies.native.mockImplementation((resolve: (name: string) => string, io: ProfileIo) => {
    onProfile?.("native", ++profileCalls.native);
    const file = resolve("mock-native"); io.lstatSync(file); io.realpathSync(file);
    return { executable: file, fingerprint: sha(io.readFileSync(file)) };
  });
  dependencies.opendir.mockImplementation(async (directory: string) => {
    enumerationCount += 1;
    onEnumeration?.(enumerationCount);
    const names = [...table.keys()].filter((file) => path.dirname(file) === fileKey(directory)).map((file) => path.basename(file));
    if (enumerationCount % 2 === 0) names.reverse();
    return { async *[Symbol.asyncIterator]() {
      for (const name of names) { const value = entry(path.join(directory, name));
        yield { name, isFile: () => !value.directory, isSymbolicLink: () => value.symbolic }; }
    } };
  });
});
afterEach(() => {
  process.execArgv.splice(0, process.execArgv.length, ...originalArguments);
  if (originalProfile === undefined) delete process.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE;
  else process.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE = originalProfile;
  vi.restoreAllMocks();
});

function layoutRequest(): WorkflowAcceptanceRuntimeObservationRequest {
  const executionDomainId = "00000001-0000-4000-8000-000000000001";
  const batchId = "00000002-0000-4000-8000-000000000001";
  const caseDirectory = path.resolve("owned-case");
  return { version: 2, operation: "observe-runtime", caseDirectory,
    context: { version: 1, batchId, caseId: "harness-retry", executionDomainId,
      sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), databaseBranchId: "br-owned",
      applicationName: `mvp_wf_${executionDomainId.replaceAll("-", "")}`,
      sdkDirectory: path.join(caseDirectory, `sdk-${executionDomainId}`) },
    provenance: { version: 1, projectId: "owned-project", databaseBranchId: "br-owned", branchName: `mvp-wf-${executionDomainId}`,
      executionDomainId, batchId, sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64),
      createdAt: "2026-10-14T10:00:00.000Z", endpointId: "ep-owned-123",
      endpointHost: "ep-owned-123.us-east-1.aws.neon.tech", databaseName: "ci_test", creationRequestId: "request-1",
      databaseId: 123, databaseCreatedAt: "2026-10-14T10:00:00.000Z", databaseOwner: "neondb_owner", parentBranchId: "br-parent" },
    ownedProcessIds: [100], processInventoryRef: { sha256: "1".repeat(64) }, childReportRef: { sha256: "2".repeat(64) },
    runtimeInventoryRefs: [{ launchId: "00000003-0000-4000-8000-000000000001", sha256: "3".repeat(64) }],
    expectedFingerprints: { adapterFingerprint: "c".repeat(64), sdkFactoryFingerprint: "d".repeat(64) } };
}

function fixture(launchCount = 1, realmCount = 2) {
  const request = layoutRequest(), owner = request.context.executionDomainId;
  for (const name of adapterNames) putBytes(sourcePath(name), Buffer.from(`mock adapter bytes: ${name}\n`));
  putBytes(sdkSource, Buffer.from("mock SDK source bytes\n"));
  putBytes(nativeSource, Buffer.from("mock native source bytes\n"));
  request.expectedFingerprints = {
    adapterFingerprint: sha(adapterNames.map((name) => `${name}:${sha(entry(sourcePath(name)).bytes)}`).join("\n")),
    sdkFactoryFingerprint: sha(`${sha(entry(sdkSource).bytes)}\n${sha(entry(nativeSource).bytes)}`),
  };
  const node = { imagePath: "C:\\Program Files\\nodejs\\node.exe", sha256: "e".repeat(64), byteLength: 90_000_000,
    volumeSerialNumber: 1, fileIndex: "0000000000000001", pinnedAt: at(0) };
  const esbuild = { imagePath: "D:\\owned\\esbuild.exe", sha256: "f".repeat(64), byteLength: 11_000_000,
    volumeSerialNumber: 2, fileIndex: "0000000000000002", pinnedAt: at(0) };
  const processes: WorkflowAcceptanceProcessInventory = { version: 1, context: request.context, phase: "business",
    rootProcessId: 100, startedAt: at(1), stoppedAt: at(9), expectedImages: { node, esbuild },
    members: Array.from({ length: launchCount }, (_, index) => ({ processId: 100 + index,
      imageObservationStatus: "observed", image: { kind: "node", imagePath: node.imagePath, sha256: node.sha256,
        byteLength: node.byteLength, volumeSerialNumber: node.volumeSerialNumber, fileIndex: node.fileIndex, observedAt: at(2) }, exitCode: 0 })),
    totalProcesses: launchCount, remainingOwnedProcesses: 0, inventoryComplete: true, stdoutEof: true, stderrEof: true,
    termination: "natural", observationStatus: "observed" };
  const inventories: WorkflowAcceptanceRuntimeInventory[] = Array.from({ length: launchCount }, (_, launchIndex) => {
    const processId = 100 + launchIndex;
    const value: WorkflowAcceptanceRuntimeInventory = { version: 1,
      launch: { version: 1, context: request.context, launchId: id(processId, 2), processId, threadId: 0,
        startedAt: at(2), ...request.expectedFingerprints, configuredVm: "node" },
      creationEvents: [], realms: [], handlers: [{ sequence: 1, handlerId: id(processId, 6), startedAt: at(4), settledAt: at(5), result: "fulfilled" }],
      pendingCreationIds: [], failedCreationIds: [], unfinishedHandlerIds: [], dispatchStoppedAt: at(6), dispatchStoppedAfterHandlerSequence: 1,
      creationsSealedAt: at(7), creationsSealedAfterEventSequence: realmCount * 2, collectedAt: at(8), cleanupPermitted: false };
    for (let realmIndex = 0; realmIndex < realmCount; realmIndex++) {
      const number = processId * 256 + realmIndex, realmId = id(number, 3), creationId = id(number, 4);
      const factory = realmIndex === 0 ? "host" as const : "node-vm" as const;
      const parentRealmId = realmIndex === 0 ? null : id(processId * 256, 3), pools = [id(number, 5)];
      value.creationEvents.push({ sequence: realmIndex * 2 + 1, creationId, factory, phase: "started", parentRealmId, realmId: null, at: at(3), failureCode: null },
        { sequence: realmIndex * 2 + 2, creationId, factory, phase: "returned", parentRealmId, realmId, at: at(3), failureCode: null });
      value.realms.push({ realmId, factory, parentRealmId, poolCreationIds: pools,
        poolCloseReceipt: { ownerId: owner, state: "callbacks_completed", poolIds: pools, completedIds: [...pools], failedIds: [], unknownIds: [], cleanupPermitted: false } });
    }
    return value;
  });
  const realm = inventories[0].realms[realmCount - 1];
  const child: WorkflowAcceptanceChildReport = { version: 1, context: request.context, businessStatus: "passed", failureCode: null, cleanupPermitted: false,
    realms: [{ executionDomainId: owner, realmId: realm.realmId, processId: 100, threadId: 0, pools: structuredClone(realm.poolCloseReceipt!) }] };
  const processFile = path.join(request.caseDirectory, "business-process-inventory.json"), childFile = path.join(request.caseDirectory, "child-result.json");
  const runtimeDirectory = path.join(request.context.sdkDirectory, "runtime-inventory");
  const runtimeFiles = inventories.map((inventory) => path.join(runtimeDirectory, `${inventory.launch.launchId}.json`));
  putBytes(path.join(request.caseDirectory, "context.json"), Buffer.from(JSON.stringify(request.context)));
  putBytes(path.join(request.context.sdkDirectory, "owner-context.json"), Buffer.from(JSON.stringify(request.context)));
  putBytes(path.join(request.caseDirectory, "creation-provenance.json"), Buffer.from(JSON.stringify(request.provenance)));
  function writeEvidence() {
    putBytes(processFile, Buffer.from(JSON.stringify(processes)));
    putBytes(childFile, Buffer.from(JSON.stringify(child)));
    inventories.forEach((inventory, index) => putBytes(runtimeFiles[index], Buffer.from(JSON.stringify(inventory))));
    request.ownedProcessIds = processes.members.map((member) => member.processId);
    request.processInventoryRef.sha256 = sha(entry(processFile).bytes);
    request.childReportRef.sha256 = sha(entry(childFile).bytes);
    request.runtimeInventoryRefs = inventories.map((inventory, index) => ({ launchId: inventory.launch.launchId, sha256: sha(entry(runtimeFiles[index]).bytes) }));
  }
  writeEvidence();
  return { request, processes, child, inventories, processFile, childFile, runtimeDirectory, runtimeFiles, writeEvidence };
}
function expectUnknown(result: WorkflowAcceptanceRuntimeCoverageEvaluation, failure?: WorkflowAcceptanceRuntimeCoverageFailure) {
  expect(result.status).toBe("unconfirmed"); expect(result.cleanupPermitted).toBe(false);
  expect(result.counts).toEqual({ processes: null, nodeProcesses: null, launches: null, realms: null, pools: null });
  expect(result.failures.length).toBeGreaterThan(0);
  if (failure) expect(result.failures).toContain(failure);
  expect(WorkflowAcceptanceRuntimeCoverageEvaluation.safeParse(result).success).toBe(true);
}

describe("运行证据读取器的无副作用请求边界", () => {
  it("实际父控制器布局通过路径边界并进入模拟目录核验，不代表完整证据成功", async () => {
    vi.clearAllMocks();
    dependencies.lstat.mockRejectedValueOnce(new Error("模拟停止，不读取真实目录"));
    const request = layoutRequest();
    const result = await collectOwnedWorkflowRuntimeFacts(request);
    expect(dependencies.lstat).toHaveBeenCalledExactlyOnceWith(request.caseDirectory, { bigint: true });
    expect(result.failures).toEqual(["context-mismatch"]);
    expect(result.cleanupPermitted).toBe(false);
    expect(dependencies.read).not.toHaveBeenCalled();
    expect(dependencies.sdk).not.toHaveBeenCalled();
    expect(dependencies.native).not.toHaveBeenCalled();
  });

  it.each(["sdk", "sdk-00000004-0000-4000-8000-000000000001"])("拒绝错布局 %s，不访问目录", async (directory) => {
    vi.clearAllMocks();
    const request = layoutRequest();
    request.context.sdkDirectory = path.join(request.caseDirectory, directory);
    const result = await collectOwnedWorkflowRuntimeFacts(request);
    expect(result.failures).toEqual(["context-mismatch"]);
    expect(result.cleanupPermitted).toBe(false);
    for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, [], "request", 2])("拒绝不完整请求 %j，不读取文件或激活运行时", async (request) => {
    vi.clearAllMocks();
    const result = await collectOwnedWorkflowRuntimeFacts(request);
    expect(result).toEqual({ version: 2, status: "unconfirmed", cleanupPermitted: false,
      failures: ["invalid-request"], counts: { processes: null, nodeProcesses: null, launches: null, realms: null, pools: null } });
    for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
  });

  it("拒绝 getter，不能在契约解析时执行调用者代码", async () => {
    vi.clearAllMocks();
    const getter = vi.fn(() => 2);
    const request = Object.defineProperty({}, "version", { enumerable: true, get: getter });
    const result = await collectOwnedWorkflowRuntimeFacts(request);
    expect(result.failures).toEqual(["invalid-request"]);
    expect(result.cleanupPermitted).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
  });

  it("拒绝代理，不触发 ownKeys 或 get 陷阱", async () => {
    vi.clearAllMocks();
    const ownKeys = vi.fn(() => []), get = vi.fn();
    const result = await collectOwnedWorkflowRuntimeFacts(new Proxy({}, { ownKeys, get }));
    expect(result.failures).toEqual(["invalid-request"]);
    expect(result.cleanupPermitted).toBe(false);
    expect(ownKeys).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
  });

  it("拒绝循环数据，不进入证据读取或域判定", async () => {
    vi.clearAllMocks();
    const request: Record<string, unknown> = {};
    request.context = request;
    const result = await collectOwnedWorkflowRuntimeFacts(request);
    expect(result.failures).toEqual(["invalid-request"]);
    expect(result.cleanupPermitted).toBe(false);
    for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
  });

  it.each(["object", "array"])("拒绝 %s 原型 constructor 代理，不触发任何陷阱", async (kind) => {
    const request = layoutRequest(), getOwnPropertyDescriptor = vi.fn(), get = vi.fn(), ownKeys = vi.fn();
    if (kind === "object") {
      const prototype = Object.create(null);
      Object.defineProperty(prototype, "constructor", { value: new Proxy(Object, { getOwnPropertyDescriptor, get, ownKeys }) });
      Object.setPrototypeOf(request, prototype);
    } else {
      const prototype: unknown[] = [];
      Object.defineProperty(prototype, "constructor", { value: new Proxy(Array, { getOwnPropertyDescriptor, get, ownKeys }) });
      Object.setPrototypeOf(request.ownedProcessIds, prototype);
    }
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(request), "invalid-request");
    expect(getOwnPropertyDescriptor).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(ownKeys).not.toHaveBeenCalled();
    for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
  });
});

describe("内存原始证据全集消费与真实域判定（不连接 SDK 或数据库）", () => {
  it.each([[1, 2], [1, 17], [2, 19], [64, 1]])("完整 %i 启动、每启动 %i 空间，不截断全集", async (launches, realms) => {
    const value = fixture(launches, realms), result = await collectOwnedWorkflowRuntimeFacts(value.request);
    expect(result).toEqual({ version: 2, status: "consistent", cleanupPermitted: false, failures: [],
      counts: { processes: launches, nodeProcesses: launches, launches, realms: launches * realms, pools: launches * realms } });
    expect(enumerationCount).toBe(2);
    expect(dependencies.sdk).toHaveBeenCalledTimes(2); expect(dependencies.native).toHaveBeenCalledTimes(2);
    for (const file of value.runtimeFiles) expect(dependencies.read).toHaveBeenCalledWith(file, 512 * 1024);
    expect(descriptors.size).toBe(0);
  });

  it("双次完整枚举顺序变化允许，不依赖目录返回顺序", async () => {
    const value = fixture(3), result = await collectOwnedWorkflowRuntimeFacts(value.request);
    expect(result.status).toBe("consistent"); expect(result.counts.launches).toBe(3); expect(enumerationCount).toBe(2);
  });

  it.each(["missing", "extra", "non-uuid", "symlink", "directory", "65"])("拒绝全集异常 %s", async (kind) => {
    const value = fixture(kind === "65" ? 64 : 1);
    if (kind === "missing") table.delete(fileKey(value.runtimeFiles[0]));
    else if (kind === "symlink") entry(value.runtimeFiles[0]).symbolic = true;
    else if (kind === "directory") entry(value.runtimeFiles[0]).directory = true;
    else putBytes(path.join(value.runtimeDirectory, kind === "non-uuid" ? "notes.json" : `${id(900, 2)}.json`), Buffer.from("{}"));
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), kind === "missing" || kind === "extra" ? "launch-set-mismatch" : "invalid-runtime-inventory");
  });

  it.each(["add", "remove", "rename"])("第二次枚举 %s 时拒绝，不把第一次集合当完整", async (kind) => {
    const value = fixture(2);
    onEnumeration = (count) => {
      if (count !== 2) return;
      if (kind === "add") putBytes(path.join(value.runtimeDirectory, `${id(900, 2)}.json`), Buffer.from("{}"));
      else {
        const original = entry(value.runtimeFiles[0]); table.delete(fileKey(value.runtimeFiles[0]));
        if (kind === "rename") table.set(fileKey(path.join(value.runtimeDirectory, `${id(900, 2)}.json`)), original);
      }
    };
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), "launch-set-mismatch");
  });

  it.each(["process", "child", "runtime"])("%s 原始字节变化但 JSON 等价仍拒绝旧 SHA", async (kind) => {
    const value = fixture(), file = kind === "process" ? value.processFile : kind === "child" ? value.childFile : value.runtimeFiles[0];
    entry(file).bytes = Buffer.concat([Buffer.from(" \n"), entry(file).bytes]);
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), kind === "process" ? "invalid-process-inventory" : kind === "child" ? "invalid-child-report" : "invalid-runtime-inventory");
  });

  it.each(["process", "child", "runtime"])("%s 使用含 BOM 与空白原bytes的正确SHA允许，不重序列化算hash", async (kind) => {
    const value = fixture(), file = kind === "process" ? value.processFile : kind === "child" ? value.childFile : value.runtimeFiles[0];
    entry(file).bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(" \n"), entry(file).bytes, Buffer.from("\n")]);
    const hash = sha(entry(file).bytes);
    if (kind === "process") value.request.processInventoryRef.sha256 = hash;
    else if (kind === "child") value.request.childReportRef.sha256 = hash;
    else value.request.runtimeInventoryRefs[0].sha256 = hash;
    expect((await collectOwnedWorkflowRuntimeFacts(value.request)).status).toBe("consistent");
  });

  it.each(["process", "child", "runtime"])("拒绝 %s 读取后mtime漂移", async (kind) => {
    const value = fixture(), file = fileKey(kind === "process" ? value.processFile : kind === "child" ? value.childFile : value.runtimeFiles[0]);
    onRead = (current) => { if (current === file) entry(current).time++; };
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request));
  });

  it.each(["file-ino", "file-time", "directory-ino", "directory-symlink", "directory-time", "directory-links"])("末尾复核拒绝 %s 漂移", async (kind) => {
    const value = fixture();
    onProfile = (profile, call) => {
      if (profile !== "native" || call !== 2) return;
      if (kind === "file-ino") entry(value.childFile).ino++;
      if (kind === "file-time") entry(value.processFile).time++;
      if (kind === "directory-ino") entry(value.runtimeDirectory).ino++;
      if (kind === "directory-symlink") entry(value.runtimeDirectory).symbolic = true;
      if (kind === "directory-time") entry(value.runtimeDirectory).time++;
      if (kind === "directory-links") entry(value.runtimeDirectory).links++;
    };
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), "runtime-lifecycle-unconfirmed");
  });

  it.each(["adapter", "sdk", "native"])("独立 %s 来源字节与请求指纹不一致时拒绝自报通过", async (kind) => {
    const value = fixture(), file = kind === "adapter" ? sourcePath(adapterNames[0]) : kind === "sdk" ? sdkSource : nativeSource;
    entry(file).bytes = Buffer.from("independent changed bytes");
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), "source-fingerprint-mismatch");
    expect(dependencies.read).not.toHaveBeenCalledWith(value.processFile, expect.anything());
  });

  it.each(["adapter", "sdk", "native"])("末次 %s 来源复核拒绝字节漂移", async (kind) => {
    const value = fixture();
    onEnumeration = (count) => {
      if (count !== 2) return;
      const file = kind === "adapter" ? sourcePath(adapterNames[0]) : kind === "sdk" ? sdkSource : nativeSource;
      entry(file).bytes = Buffer.from("late independent changed bytes"); entry(file).time++;
    };
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), "source-fingerprint-mismatch");
  });

  it.each(["adapter", "sdk", "native"])("末次工厂收尾时%s来源元数据漂移仍拒绝", async (kind) => {
    const value = fixture();
    onProfile = (profile, call) => {
      if (profile === "native" && call === 2) {
        const file = kind === "adapter" ? sourcePath(adapterNames[0]) : kind === "sdk" ? sdkSource : nativeSource;
        entry(file).time++;
      }
    };
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), "source-fingerprint-mismatch");
  });

  it("拒绝解析到其他候选依赖目录，不借上级依赖图", async () => {
    const value = fixture();
    dependencies.createRequire.mockImplementation(() => ({ resolve: () => path.resolve(PROJECT, "../other-candidate/node_modules/runtime.js") }));
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), "source-fingerprint-mismatch");
  });

  it.each(["context", "owner", "provenance"])("拒绝%s文件与请求归属不匹配", async (kind) => {
    const value = fixture(), file = kind === "context" ? path.join(value.request.caseDirectory, "context.json")
      : kind === "owner" ? path.join(value.request.context.sdkDirectory, "owner-context.json")
        : path.join(value.request.caseDirectory, "creation-provenance.json");
    const actual = kind === "provenance" ? { ...value.request.provenance, projectId: "different-owned-project" }
      : { ...value.request.context, sourceCommit: "f".repeat(40) };
    putBytes(file, Buffer.from(JSON.stringify(actual)));
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), "context-mismatch");
    expect(dependencies.sdk).not.toHaveBeenCalled();
  });

  it.each(["zero", "oversize", "hardlink"])("拒绝runtime原文件%s边界", async (kind) => {
    const value = fixture(), file = entry(value.runtimeFiles[0]);
    if (kind === "zero") file.bytes = Buffer.alloc(0);
    if (kind === "oversize") file.reportedSize = 512 * 1024 + 1;
    if (kind === "hardlink") file.links = 2;
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), "invalid-runtime-inventory");
  });

  it.each(["pid", "thread", "pool"])("child正确原bytes SHA但%s不匹配由真实domain拒绝", async (kind) => {
    const value = fixture();
    if (kind === "pid") value.child.realms[0].processId++;
    if (kind === "thread") value.child.realms[0].threadId++;
    if (kind === "pool") {
      value.child.realms[0].pools.poolIds = [id(999, 5)]; value.child.realms[0].pools.completedIds = [id(999, 5)];
    }
    value.writeEvidence();
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), "child-receipt-mismatch");
  });

  it.each(["natural", "stdout", "stderr", "exit", "pending", "handler", "pool"])("%s 未确认必须全countnull而非零", async (kind) => {
    const value = fixture();
    if (["natural", "stdout", "stderr", "exit"].includes(kind)) {
      value.processes.observationStatus = "unknown";
      if (kind === "natural") value.processes.termination = "unknown";
      if (kind === "stdout") value.processes.stdoutEof = false;
      if (kind === "stderr") value.processes.stderrEof = false;
      if (kind === "exit") { value.processes.inventoryComplete = false; value.processes.members[0].exitCode = null; }
    }
    if (kind === "pending") {
      const inventory = value.inventories[0], creationId = id(999, 4);
      inventory.creationEvents.push({ sequence: inventory.creationEvents.length + 1, creationId, factory: "node-vm", phase: "started",
        parentRealmId: inventory.realms[0].realmId, realmId: null, at: at(3), failureCode: null });
      inventory.pendingCreationIds = [creationId]; inventory.creationsSealedAfterEventSequence = inventory.creationEvents.length;
    }
    if (kind === "handler") {
      const inventory = value.inventories[0]; inventory.handlers[0].settledAt = null; inventory.handlers[0].result = "unknown";
      inventory.unfinishedHandlerIds = [inventory.handlers[0].handlerId];
    }
    if (kind === "pool") value.inventories[0].realms[0].poolCloseReceipt = null;
    value.writeEvidence();
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), ["pending", "handler"].includes(kind) ? "runtime-lifecycle-unconfirmed"
      : kind === "pool" ? "pool-close-unconfirmed" : "process-exit-unconfirmed");
  });

  it.each(["profile", "import-pair", "import-inline"])("已激活条件 %s 时不得调用profile工厂", async (kind) => {
    const value = fixture();
    if (kind === "profile") process.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE = "node-sdk5-v1";
    else process.execArgv.push(...(kind === "import-pair" ? ["--import", "mock-preload"] : ["--import=mock-preload"]));
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request), "source-fingerprint-mismatch");
    expect(dependencies.sdk).not.toHaveBeenCalled(); expect(dependencies.native).not.toHaveBeenCalled();
    expect(dependencies.createRequire).not.toHaveBeenCalled();
  });

  it.each(["async-stat", "reader", "enumerate", "sdk-profile", "native-profile", "source-open", "source-read", "source-close"])("%s 异常保留未知，绝不授予清理", async (kind) => {
    const value = fixture(), failure = () => { throw new Error("模拟异常"); };
    if (kind === "async-stat") dependencies.lstat.mockImplementation(failure);
    if (kind === "reader") dependencies.read.mockImplementation(failure);
    if (kind === "enumerate") dependencies.opendir.mockImplementation(failure);
    if (kind === "sdk-profile") dependencies.sdk.mockImplementation(failure);
    if (kind === "native-profile") dependencies.native.mockImplementation(failure);
    if (kind === "source-open") dependencies.openSync.mockImplementation(failure);
    if (kind === "source-read") dependencies.readSync.mockImplementation(failure);
    if (kind === "source-close") dependencies.closeSync.mockImplementation(failure);
    expectUnknown(await collectOwnedWorkflowRuntimeFacts(value.request));
  });
});

describe("无参只读指纹出口（仅内存来源模拟）", () => {
  it("独立从fixture原bytes派生两个hash，不接收或倒填请求中的期望值", async () => {
    const value = fixture();
    const expected = { adapterFingerprint: sha(adapterNames.map((name) => `${name}:${sha(entry(sourcePath(name)).bytes)}`).join("\n")),
      sdkFactoryFingerprint: sha(`${sha(entry(sdkSource).bytes)}\n${sha(entry(nativeSource).bytes)}`) };
    value.request.expectedFingerprints = { adapterFingerprint: "0".repeat(64), sdkFactoryFingerprint: "0".repeat(64) };
    const result = await deriveOwnedWorkflowRuntimeFingerprints();
    expect(result).toEqual(expected);
    expect(Object.keys(result).sort()).toEqual(["adapterFingerprint", "sdkFactoryFingerprint"]);
    expect(WorkflowAcceptanceRuntimeFingerprints.safeParse(result).success).toBe(true);
    expect(deriveOwnedWorkflowRuntimeFingerprints.length).toBe(0);
    expect(dependencies.sdk).toHaveBeenCalledTimes(1); expect(dependencies.native).toHaveBeenCalledTimes(1);
    expect(dependencies.lstat).not.toHaveBeenCalled(); expect(dependencies.read).not.toHaveBeenCalled();
    expect(dependencies.opendir).not.toHaveBeenCalled(); expect(descriptors.size).toBe(0);
  });

  it.each(["adapter", "sdk", "native"])("%s 初始字节独立改变输出，不使用冻结请求期望值", async (kind) => {
    const value = fixture(), previous = { ...value.request.expectedFingerprints };
    const file = kind === "adapter" ? sourcePath(adapterNames[0]) : kind === "sdk" ? sdkSource : nativeSource;
    entry(file).bytes = Buffer.from("changed mock source before independent scan\n");
    const expected = { adapterFingerprint: sha(adapterNames.map((name) => `${name}:${sha(entry(sourcePath(name)).bytes)}`).join("\n")),
      sdkFactoryFingerprint: sha(`${sha(entry(sdkSource).bytes)}\n${sha(entry(nativeSource).bytes)}`) };
    const result = await deriveOwnedWorkflowRuntimeFingerprints();
    expect(result).toEqual(expected); expect(result).not.toEqual(previous);
    expect(value.request.expectedFingerprints).toEqual(previous);
  });

  it.each(["adapter-bytes", "sdk-bytes", "native-bytes", "adapter-meta", "sdk-meta", "native-meta"])("%s 在派生后最终复核前漂移必须拒绝", async (kind) => {
    fixture();
    onProfile = (profile, call) => {
      if (profile !== "native" || call !== 1) return;
      queueMicrotask(() => {
        const file = kind.startsWith("adapter") ? sourcePath(adapterNames[0]) : kind.startsWith("sdk") ? sdkSource : nativeSource;
        const value = entry(file); value.time++;
        if (kind.endsWith("bytes")) { const bytes = Buffer.from(value.bytes); bytes[0] ^= 1; value.bytes = bytes; }
      });
    };
    await expect(deriveOwnedWorkflowRuntimeFingerprints()).rejects.toThrow();
    expect(descriptors.size).toBe(0);
  });

  it.each(["profile", "import-pair", "import-inline"])("%s 激活条件在独立出口拒绝且零sourceIO/builder", async (kind) => {
    fixture();
    if (kind === "profile") process.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE = "node-sdk5-v1";
    else process.execArgv.push(...(kind === "import-pair" ? ["--import", "mock-preload"] : ["--import=mock-preload"]));
    await expect(deriveOwnedWorkflowRuntimeFingerprints()).rejects.toThrow();
    for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
  });
});
