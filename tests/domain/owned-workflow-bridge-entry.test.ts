import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { WorkflowAcceptanceContext } from "@/contracts/workflow-case-acceptance";
import { WorkflowAcceptanceBridgeRequest } from "@/contracts/workflow-acceptance-bridge";
import { WorkflowAcceptanceRuntimeObservationRequest } from "@/contracts/workflow-runtime-observation";

const mocks = vi.hoisted(() => ({ lstat: vi.fn(), realpath: vi.fn(), write: vi.fn(), read: vi.fn(), derive: vi.fn(), collect: vi.fn(),
  bridge: vi.fn(), verify: vi.fn(), pg: vi.fn(), network: vi.fn(), bridgeLoads: 0, verifierLoads: 0, pgLoads: 0 }));
vi.mock("node:fs/promises", () => ({ lstat: mocks.lstat, realpath: mocks.realpath, writeFile: mocks.write }));
vi.mock("../helpers/read-owned-workflow-json", () => ({ readOwnedWorkflowJson: mocks.read }));
vi.mock("../helpers/collect-owned-workflow-runtime-facts", () => ({ deriveOwnedWorkflowRuntimeFingerprints: mocks.derive, collectOwnedWorkflowRuntimeFacts: mocks.collect }));
vi.mock("../../scripts/workflow-acceptance-case-bridge", () => { mocks.bridgeLoads++; return { runWorkflowAcceptanceBridge: mocks.bridge }; });
vi.mock("../helpers/verify-owned-workflow-control-plane", () => { mocks.verifierLoads++; return { verifyOwnedWorkflowControlPlane: mocks.verify }; });
vi.mock("postgres", () => { mocks.pgLoads++; return { default: mocks.pg }; });

import { runOwnedWorkflowBridgeEntry } from "../helpers/run-owned-workflow-bridge-entry";

const records = new Map<string, unknown>(), writes = new Map<string, string>();
const directories = new Map<string, { ino: number; time: number; links: number; symbolic: boolean; directory: boolean }>();
const canonical = new Map<string, string>();
const key = (file: string) => path.resolve(file);
const names = { probe: "context.json", runtime: "observe-runtime-request.json", fingerprints: "expected-fingerprints.json", evaluation: "runtime-coverage-evaluation.json" };
function fixture() {
  const directory = path.resolve("owned-entry-fixture"), domain = "11111111-1111-4111-8111-111111111111";
  const context = WorkflowAcceptanceContext.parse({ version: 1, batchId: "22222222-2222-4222-8222-222222222222", caseId: "harness-retry",
    sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), executionDomainId: domain, databaseBranchId: "br-owned",
    applicationName: `mvp_wf_${domain.replaceAll("-", "")}`, sdkDirectory: path.join(directory, `sdk-${domain}`) });
  const provenance = { version: 1, projectId: "cold-recipe-55563307", databaseBranchId: context.databaseBranchId,
    branchName: `mvp-wf-${domain}`, executionDomainId: domain, batchId: context.batchId,
    sourceCommit: context.sourceCommit, sourceFingerprint: context.sourceFingerprint, createdAt: "2026-10-14T10:00:00.000Z",
    endpointId: "ep-owned", endpointHost: "ep-owned.example.neon.tech", databaseName: "ci_test", creationRequestId: "fixture",
    databaseId: 1, databaseCreatedAt: "2026-10-14T10:00:01.000Z", databaseOwner: "neondb_owner", parentBranchId: "br-parent" };
  const runtime = WorkflowAcceptanceRuntimeObservationRequest.parse({ version: 2, operation: "observe-runtime", context, provenance,
    caseDirectory: directory, ownedProcessIds: [100], processInventoryRef: { sha256: "c".repeat(64) }, childReportRef: { sha256: "d".repeat(64) },
    runtimeInventoryRefs: [{ launchId: "33333333-3333-4333-8333-333333333333", sha256: "e".repeat(64) }],
    expectedFingerprints: { adapterFingerprint: "f".repeat(64), sdkFactoryFingerprint: "0".repeat(64) } });
  records.set(key(path.join(directory, names.probe)), context);
  records.set(key(path.join(context.sdkDirectory, "owner-context.json")), context);
  records.set(key(path.join(directory, names.runtime)), runtime);
  for (const file of [directory, context.sdkDirectory]) {
    for (let current = key(file); ; current = path.dirname(current)) {
      if (!directories.has(current)) directories.set(current, { ino: directories.size + 1, time: 1, links: 1, symbolic: false, directory: true });
      if (path.dirname(current) === current) break;
    }
  }
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test", MVP_WORKFLOW_ACCEPTANCE_CONTEXT: JSON.stringify(context) };
  const uriRead = vi.fn(() => { throw new Error("只读分支不可读取数据库URI"); });
  const keyRead = vi.fn(() => { throw new Error("只读分支不可读取控制面密钥"); });
  Object.defineProperty(environment, "MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED", { get: uriRead });
  Object.defineProperty(environment, "MVP_WORKFLOW_ACCEPTANCE_CONTROL_KEY", { get: keyRead });
  const file = (name: string) => path.join(directory, name);
  const legacy = (operation: "observe" | "observe-empty" | "finalize") => {
    const shared = { version: 1, operation, context, provenance, caseDirectory: directory };
    const processObservation = { executionDomainId: domain, sourceMatched: true, launchOwnershipVerified: true, termination: "natural", exitCode: 0,
      processObservationComplete: true, remainingOwnedProcesses: 0, allRealmReceiptsCollected: false, ownedBranchVerified: false,
      applicationName: context.applicationName, databaseBranchId: context.databaseBranchId, databaseObservationComplete: false,
      databaseSnapshotFresh: false, databaseConnections: null, activeSql: null, sdkDirectoryOwnershipVerified: true };
    const cleanup = { status: "not-attempted", databaseBranchId: context.databaseBranchId, ownershipVerified: false,
      lifecycleAuthorizationVerified: false, deletionRequestSucceeded: false, absenceVerified: false };
    return WorkflowAcceptanceBridgeRequest.parse(operation === "observe" ? { ...shared, ownedProcessIds: [100], processObservation }
      : operation === "finalize" ? { ...shared, cleanup } : shared);
  };
  return { directory, context, runtime, environment, file, legacy, uriRead, keyRead };
}
function assertReadonly(value: ReturnType<typeof fixture>) {
  expect(mocks.bridgeLoads).toBe(0); expect(mocks.verifierLoads).toBe(0); expect(mocks.pgLoads).toBe(0);
  expect(mocks.bridge).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.pg).not.toHaveBeenCalled();
  expect(mocks.network).not.toHaveBeenCalled(); expect(value.uriRead).not.toHaveBeenCalled(); expect(value.keyRead).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetModules(); records.clear(); writes.clear(); directories.clear(); canonical.clear();
  for (const mock of [mocks.lstat, mocks.realpath, mocks.write, mocks.read, mocks.derive, mocks.collect, mocks.bridge, mocks.verify, mocks.pg, mocks.network]) mock.mockReset();
  mocks.bridgeLoads = 0; mocks.verifierLoads = 0; mocks.pgLoads = 0;
  vi.doMock("../../scripts/workflow-acceptance-case-bridge", () => { mocks.bridgeLoads++; return { runWorkflowAcceptanceBridge: mocks.bridge }; });
  vi.doMock("../helpers/verify-owned-workflow-control-plane", () => { mocks.verifierLoads++; return { verifyOwnedWorkflowControlPlane: mocks.verify }; });
  vi.doMock("postgres", () => { mocks.pgLoads++; return { default: mocks.pg }; });
  mocks.read.mockImplementation(async (file: string) => {
    if (!records.has(key(file))) throw new Error("模拟文件不存在"); return records.get(key(file));
  });
  mocks.lstat.mockImplementation(async (file: string) => {
    const value = directories.get(key(file)); if (!value) throw new Error("模拟目录不存在");
    return { dev: BigInt(1), ino: BigInt(value.ino), mtimeNs: BigInt(value.time), ctimeNs: BigInt(value.time), nlink: BigInt(value.links),
      isDirectory: () => value.directory, isSymbolicLink: () => value.symbolic };
  });
  mocks.realpath.mockImplementation(async (file: string) => canonical.get(key(file)) ?? key(file));
  mocks.write.mockImplementation(async (file: string, bytes: string, options: unknown) => {
    expect(options).toEqual({ encoding: "utf8", flag: "wx" });
    if (writes.has(key(file)) || records.has(key(file))) throw new Error("模拟wx拒绝覆盖"); writes.set(key(file), bytes);
  });
  mocks.derive.mockResolvedValue({ adapterFingerprint: "1".repeat(64), sdkFactoryFingerprint: "2".repeat(64) });
  mocks.collect.mockResolvedValue({ version: 2, status: "consistent", cleanupPermitted: false, failures: [],
    counts: { processes: 1, nodeProcesses: 1, launches: 1, realms: 17, pools: 17 } });
  mocks.verify.mockResolvedValue(undefined);
  mocks.bridge.mockImplementation(async (request, verify) => { await verify(request, null); });
  mocks.pg.mockImplementation(() => { throw new Error("禁止PG构造"); });
  mocks.network.mockImplementation(() => { throw new Error("禁止真实网络"); });
  vi.stubGlobal("fetch", mocks.network);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("固定文件入口分派的普通模拟（不导入专用it注册入口）", () => {
  it("context探针仅输出正式两个hash，不倒填请求或调用旧桥接", async () => {
    const value = fixture();
    await runOwnedWorkflowBridgeEntry(value.file(names.probe), value.environment);
    expect(JSON.parse(writes.get(key(value.file(names.fingerprints)))!)).toEqual({ adapterFingerprint: "1".repeat(64), sdkFactoryFingerprint: "2".repeat(64) });
    expect(mocks.derive).toHaveBeenCalledExactlyOnceWith(); expect(mocks.collect).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledWith(value.file(names.probe), 8192);
    expect(mocks.read).toHaveBeenCalledWith(path.join(value.context.sdkDirectory, "owner-context.json"), 8192);
    assertReadonly(value);
  });
  it("严格v2将读取的原raw对象传collector，固定写evaluation，不升级清理", async () => {
    const value = fixture(); await runOwnedWorkflowBridgeEntry(value.file(names.runtime), value.environment);
    expect(mocks.collect.mock.calls[0][0]).toBe(value.runtime);
    expect(mocks.read).toHaveBeenCalledWith(value.file(names.runtime), 32 * 1024);
    expect(JSON.parse(writes.get(key(value.file(names.evaluation)))!)).toEqual({ version: 2, status: "consistent", cleanupPermitted: false, failures: [],
      counts: { processes: 1, nodeProcesses: 1, launches: 1, realms: 17, pools: 17 } });
    expect(mocks.derive).not.toHaveBeenCalled(); assertReadonly(value);
  });
  it("unconfirmed先wx保存全null失败回执，然后报告失败", async () => {
    const value = fixture(), evaluation = { version: 2, status: "unconfirmed", cleanupPermitted: false, failures: ["runtime-lifecycle-unconfirmed"],
      counts: { processes: null, nodeProcesses: null, launches: null, realms: null, pools: null } };
    mocks.collect.mockResolvedValue(evaluation);
    await expect(runOwnedWorkflowBridgeEntry(value.file(names.runtime), value.environment)).rejects.toThrow("已保留失败判定");
    expect(JSON.parse(writes.get(key(value.file(names.evaluation)))!)).toEqual(evaluation); assertReadonly(value);
  });
  it.each(["observe-empty", "observe", "finalize"] as const)("严格v1 %s只在解析后转原桥接与核验", async (operation) => {
    const value = fixture(), request = value.legacy(operation), file = value.file(`${operation}-request.json`);
    records.set(key(file), request); await runOwnedWorkflowBridgeEntry(file, value.environment);
    expect(mocks.bridgeLoads).toBe(1); expect(mocks.verifierLoads).toBe(1);
    expect(mocks.bridge).toHaveBeenCalledWith(request, expect.any(Function)); expect(mocks.verify).toHaveBeenCalledWith(request, null);
    expect(mocks.derive).not.toHaveBeenCalled(); expect(mocks.collect).not.toHaveBeenCalled(); expect(writes.size).toBe(0);
  });
  it.each(["unknown.json", "runtime-coverage-evaluation.json", "expected-fingerprints.json"])("未知或输出文件名%s不可当legacy", async (name) => {
    const value = fixture(); records.set(key(value.file(name)), value.legacy("observe-empty"));
    await expect(runOwnedWorkflowBridgeEntry(value.file(name), value.environment)).rejects.toThrow();
    expect(mocks.read).not.toHaveBeenCalled(); expect(writes.size).toBe(0); assertReadonly(value);
  });
  it.each(["relative", "dot", "parent", "unc", "whitespace", "ads"])("路径%s不能绕固定案例归属", async (kind) => {
    const value = fixture(), valid = value.file(names.probe);
    const file = kind === "relative" ? names.probe : kind === "dot" ? `${value.directory}${path.sep}.${path.sep}${names.probe}`
      : kind === "parent" ? `${value.directory}${path.sep}..${path.sep}${names.probe}` : kind === "unc" ? "\\\\host\\share\\context.json"
        : kind === "whitespace" ? ` ${valid}` : `${valid}:other`;
    await expect(runOwnedWorkflowBridgeEntry(file, value.environment)).rejects.toThrow();
    expect(mocks.read).not.toHaveBeenCalled(); expect(writes.size).toBe(0); assertReadonly(value);
  });
  it.each(["probe-v2", "runtime-v1", "legacy-v2", "legacy-wrong-operation", "runtime-wrong-version"])("版本或文件错配%s不能落到旧桥接", async (kind) => {
    const value = fixture(); let file = value.file(names.runtime), raw: unknown = value.legacy("observe-empty");
    if (kind === "probe-v2") { file = value.file(names.probe); raw = value.runtime; }
    if (kind === "legacy-v2") { file = value.file("observe-request.json"); raw = value.runtime; }
    if (kind === "legacy-wrong-operation") { file = value.file("observe-request.json"); raw = value.legacy("observe-empty"); }
    if (kind === "runtime-wrong-version") raw = { ...value.runtime, version: 1 };
    records.set(key(file), raw);
    await expect(runOwnedWorkflowBridgeEntry(file, value.environment)).rejects.toThrow();
    expect(writes.size).toBe(0); expect(mocks.collect).not.toHaveBeenCalled(); expect(mocks.derive).not.toHaveBeenCalled(); assertReadonly(value);
  });
  it.each([names.probe, names.runtime])("%s环境上下文不一致拒绝输出", async (name) => {
    const value = fixture(); value.environment.MVP_WORKFLOW_ACCEPTANCE_CONTEXT = JSON.stringify({ ...value.context, sourceCommit: "f".repeat(40) });
    await expect(runOwnedWorkflowBridgeEntry(value.file(name), value.environment)).rejects.toThrow();
    expect(writes.size).toBe(0); expect(mocks.collect).not.toHaveBeenCalled(); expect(mocks.derive).not.toHaveBeenCalled(); assertReadonly(value);
  });
  it.each([undefined, "invalid-json", " ".repeat(8193)])("环境context缺失/非法/超限拒绝，不先读取文件", async (context) => {
    const value = fixture(); value.environment.MVP_WORKFLOW_ACCEPTANCE_CONTEXT = context;
    await expect(runOwnedWorkflowBridgeEntry(value.file(names.probe), value.environment)).rejects.toThrow();
    expect(mocks.read).not.toHaveBeenCalled(); expect(writes.size).toBe(0); assertReadonly(value);
  });
  it.each(["owner", "case-context", "sdk-layout", "case-directory"])("%s不匹配不能输出任何通过文件", async (kind) => {
    const value = fixture();
    if (kind === "owner") records.set(key(path.join(value.context.sdkDirectory, "owner-context.json")), { ...value.context, sourceCommit: "f".repeat(40) });
    if (kind === "case-context") records.set(key(value.file(names.probe)), { ...value.context, sourceCommit: "f".repeat(40) });
    if (kind === "sdk-layout") {
      const context = { ...value.context, sdkDirectory: path.join(value.directory, "sdk") };
      value.runtime.context = context; value.environment.MVP_WORKFLOW_ACCEPTANCE_CONTEXT = JSON.stringify(context);
    }
    if (kind === "case-directory") value.runtime.caseDirectory = path.join(value.directory, "other");
    await expect(runOwnedWorkflowBridgeEntry(value.file(names.runtime), value.environment)).rejects.toThrow();
    expect(writes.size).toBe(0); expect(mocks.collect).not.toHaveBeenCalled(); assertReadonly(value);
  });
  it.each(["case", "sdk", "ancestor", "canonical"])("目录%s未确认拒绝派生或输出", async (kind) => {
    const value = fixture(), target = kind === "case" ? value.directory : kind === "sdk" ? value.context.sdkDirectory : path.dirname(value.directory);
    if (kind === "canonical") canonical.set(key(value.context.sdkDirectory), path.join(value.directory, "other-sdk"));
    else directories.get(key(target))!.symbolic = true;
    await expect(runOwnedWorkflowBridgeEntry(value.file(names.probe), value.environment)).rejects.toThrow();
    expect(mocks.derive).not.toHaveBeenCalled(); expect(writes.size).toBe(0); assertReadonly(value);
  });
  it.each([names.probe, names.runtime])("%s输出已存在时wx拒绝覆盖", async (name) => {
    const value = fixture(), output = value.file(name === names.probe ? names.fingerprints : names.evaluation);
    writes.set(key(output), "original-evidence");
    await expect(runOwnedWorkflowBridgeEntry(value.file(name), value.environment)).rejects.toThrow("wx拒绝覆盖");
    expect(writes.get(key(output))).toBe("original-evidence"); assertReadonly(value);
  });
  it.each(["fingerprints", "evaluation"])("%s输出必须过strict共享契约", async (kind) => {
    const value = fixture();
    if (kind === "fingerprints") mocks.derive.mockResolvedValue({ adapterFingerprint: "1".repeat(64), sdkFactoryFingerprint: "2".repeat(64), cleanupPermitted: true });
    else mocks.collect.mockResolvedValue({ version: 2, status: "consistent", cleanupPermitted: true, failures: [], counts: { processes: 1, nodeProcesses: 1, launches: 1, realms: 1, pools: 1 } });
    await expect(runOwnedWorkflowBridgeEntry(value.file(kind === "fingerprints" ? names.probe : names.runtime), value.environment)).rejects.toThrow();
    expect(writes.size).toBe(0); assertReadonly(value);
  });
  it("派生期间目录metadata漂移时不写指纹", async () => {
    const value = fixture(); mocks.derive.mockImplementation(async () => {
      directories.get(key(value.context.sdkDirectory))!.time++;
      return { adapterFingerprint: "1".repeat(64), sdkFactoryFingerprint: "2".repeat(64) };
    });
    await expect(runOwnedWorkflowBridgeEntry(value.file(names.probe), value.environment)).rejects.toThrow();
    expect(writes.size).toBe(0); assertReadonly(value);
  });
  it.each(["time", "links"])("外层祖先无关%s变化允许，不放松案例或SDK身份", async (kind) => {
    const value = fixture(); mocks.derive.mockImplementation(async () => {
      const ancestor = directories.get(key(path.dirname(value.directory)))!;
      if (kind === "time") ancestor.time++; else ancestor.links++;
      return { adapterFingerprint: "1".repeat(64), sdkFactoryFingerprint: "2".repeat(64) };
    });
    await runOwnedWorkflowBridgeEntry(value.file(names.probe), value.environment);
    expect(writes.has(key(value.file(names.fingerprints)))).toBe(true); assertReadonly(value);
  });
  it.each(["inode", "reparse", "canonical"])("外层祖先%s变化仍拒绝", async (kind) => {
    const value = fixture(); mocks.derive.mockImplementation(async () => {
      const file = key(path.dirname(value.directory)), ancestor = directories.get(file)!;
      if (kind === "inode") ancestor.ino++;
      if (kind === "reparse") ancestor.symbolic = true;
      if (kind === "canonical") canonical.set(file, path.join(file, "different-parent"));
      return { adapterFingerprint: "1".repeat(64), sdkFactoryFingerprint: "2".repeat(64) };
    });
    await expect(runOwnedWorkflowBridgeEntry(value.file(names.probe), value.environment)).rejects.toThrow();
    expect(writes.size).toBe(0); assertReadonly(value);
  });
  it.each(["reader", "derive", "collector", "write"])("%s异常保持失败，不调用PG/API或legacy", async (kind) => {
    const value = fixture(), failure = () => { throw new Error("模拟失败"); };
    if (kind === "reader") mocks.read.mockImplementation(failure);
    if (kind === "derive") mocks.derive.mockImplementation(failure);
    if (kind === "collector") mocks.collect.mockImplementation(failure);
    if (kind === "write") mocks.write.mockImplementation(failure);
    await expect(runOwnedWorkflowBridgeEntry(value.file(kind === "collector" ? names.runtime : names.probe), value.environment)).rejects.toThrow();
    expect(writes.size).toBe(0); assertReadonly(value);
  });
});
