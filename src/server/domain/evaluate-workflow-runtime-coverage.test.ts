import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { WorkflowAcceptanceRuntimeObservationRequest, WorkflowAcceptanceRuntimeCoverageEvaluation,
  type WorkflowAcceptanceRuntimeCoverageFailure } from "../../contracts/workflow-runtime-observation";
import { WorkflowAcceptanceProcessInventory } from "../../contracts/workflow-process-inventory";
import { WorkflowAcceptanceChildReport, type WorkflowAcceptanceContext } from "../../contracts/workflow-case-acceptance";
import { MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES, WorkflowAcceptanceRuntimeInventory } from "../../contracts/workflow-runtime-inventory";
import type { AcceptancePoolCloseReceipt } from "../../contracts/workflow-execution-lifecycle";
import { evaluateWorkflowRuntimeCoverage } from "./evaluate-workflow-runtime-coverage";

const id = (index: number, group: string) => `${index.toString(16).padStart(8, "0")}-0000-4000-8000-00000000000${group}`;
const owner = id(1, "1");
const at = (second: number) => `2026-10-14T10:00:${String(second).padStart(2, "0")}.000Z`;
function context(): WorkflowAcceptanceContext {
  return { version: 1, batchId: id(2, "1"), caseId: "harness-retry", executionDomainId: owner,
    sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), databaseBranchId: "br-owned",
    applicationName: `mvp_wf_${owner.replaceAll("-", "")}`, sdkDirectory: "D:/owned/sdk" };
}
function completed(poolIds: string[]): AcceptancePoolCloseReceipt {
  return { ownerId: owner, state: "callbacks_completed", poolIds: [...poolIds], completedIds: [...poolIds],
    failedIds: [], unknownIds: [], cleanupPermitted: false };
}
function runtime(processId: number, realmCount = 2): WorkflowAcceptanceRuntimeInventory {
  const value: WorkflowAcceptanceRuntimeInventory = { version: 1,
    launch: { version: 1, context: context(), launchId: id(processId, "2"), processId, threadId: 0, startedAt: at(2),
      adapterFingerprint: "c".repeat(64), sdkFactoryFingerprint: "d".repeat(64), configuredVm: "node" },
    creationEvents: [], realms: [], handlers: [{ sequence: 1, handlerId: id(processId, "6"), startedAt: at(4), settledAt: at(5), result: "fulfilled" }],
    pendingCreationIds: [], failedCreationIds: [], unfinishedHandlerIds: [], dispatchStoppedAt: at(6), dispatchStoppedAfterHandlerSequence: 1,
    creationsSealedAt: at(7), creationsSealedAfterEventSequence: realmCount * 2, collectedAt: at(8), cleanupPermitted: false };
  for (let index = 0; index < realmCount; index++) {
    const realmId = id(processId * 256 + index, "3"), creationId = id(processId * 256 + index, "4");
    const factory = index === 0 ? "host" as const : "node-vm" as const;
    const parentRealmId = index === 0 ? null : id(processId * 256, "3"), poolIds = [id(processId * 32768 + index * 128, "5")];
    value.creationEvents.push({ sequence: index * 2 + 1, creationId, factory, phase: "started", parentRealmId, realmId: null, at: at(3), failureCode: null },
      { sequence: index * 2 + 2, creationId, factory, phase: "returned", parentRealmId, realmId, at: at(3), failureCode: null });
    value.realms.push({ realmId, factory, parentRealmId, poolCreationIds: poolIds, poolCloseReceipt: completed(poolIds) });
  }
  return value;
}
function processes(nodeIds: number[], native = true): WorkflowAcceptanceProcessInventory {
  const node = { imagePath: "C:\\Program Files\\nodejs\\node.exe", sha256: "e".repeat(64), byteLength: 90_000_000,
    volumeSerialNumber: 1, fileIndex: "0000000000000001", pinnedAt: at(0) };
  const esbuild = { imagePath: "D:\\owned\\esbuild.exe", sha256: "f".repeat(64), byteLength: 11_000_000,
    volumeSerialNumber: 2, fileIndex: "0000000000000002", pinnedAt: at(0) };
  const image = (kind: "node" | "esbuild") => {
    const pin = kind === "node" ? node : esbuild;
    return { kind, imagePath: pin.imagePath, sha256: pin.sha256, byteLength: pin.byteLength,
      volumeSerialNumber: pin.volumeSerialNumber, fileIndex: pin.fileIndex, observedAt: at(2) };
  };
  const members: WorkflowAcceptanceProcessInventory["members"] = nodeIds.map((processId) => ({ processId,
    imageObservationStatus: "observed", image: image("node"), exitCode: 0 }));
  if (native) members.push({ processId: 9000, imageObservationStatus: "observed", image: image("esbuild"), exitCode: 0 });
  return { version: 1, context: context(), phase: "business", rootProcessId: nodeIds[0], startedAt: at(1), stoppedAt: at(9),
    expectedImages: { node, esbuild }, members, totalProcesses: members.length, remainingOwnedProcesses: 0,
    inventoryComplete: true, stdoutEof: true, stderrEof: true, termination: "natural", observationStatus: "observed" };
}
function child(inventory: WorkflowAcceptanceRuntimeInventory, realmIndex = 1): WorkflowAcceptanceChildReport {
  const realm = inventory.realms[realmIndex];
  return { version: 1, context: context(), businessStatus: "passed", failureCode: null, cleanupPermitted: false,
    realms: [{ executionDomainId: owner, realmId: realm.realmId, processId: inventory.launch.processId, threadId: inventory.launch.threadId,
      pools: structuredClone(realm.poolCloseReceipt!) }] };
}
function fixture(nodeIds = [100], realmCount = 2, native = true) {
  const inventories = nodeIds.map((processId) => runtime(processId, realmCount)), processInventory = processes(nodeIds, native);
  const request: WorkflowAcceptanceRuntimeObservationRequest = { version: 2, operation: "observe-runtime", context: context(), caseDirectory: "D:/owned/case",
    provenance: { version: 1, projectId: "owned-project", databaseBranchId: "br-owned", branchName: `mvp-wf-${owner}`,
      executionDomainId: owner, batchId: id(2, "1"), sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), createdAt: at(0),
      endpointId: "ep-owned-123", endpointHost: "ep-owned-123.us-east-1.aws.neon.tech", databaseName: "ci_test", creationRequestId: "request-1",
      databaseId: 123, databaseCreatedAt: at(0), databaseOwner: "neondb_owner", parentBranchId: "br-parent" },
    ownedProcessIds: processInventory.members.map((member) => member.processId), processInventoryRef: { sha256: "1".repeat(64) },
    childReportRef: { sha256: "2".repeat(64) }, runtimeInventoryRefs: inventories.map((inventory) => ({ launchId: inventory.launch.launchId, sha256: "3".repeat(64) })),
    expectedFingerprints: { adapterFingerprint: "c".repeat(64), sdkFactoryFingerprint: "d".repeat(64) } };
  return { request, processInventory, childReport: child(inventories[0]), inventories };
}
type Fixture = ReturnType<typeof fixture>;
function evaluate(value: Fixture) {
  return evaluateWorkflowRuntimeCoverage(value.request, value.processInventory, value.childReport, value.inventories);
}
function expectValid(value: Fixture) {
  expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse(value.request).success).toBe(true);
  expect(WorkflowAcceptanceProcessInventory.safeParse(value.processInventory).success).toBe(true);
  expect(WorkflowAcceptanceChildReport.safeParse(value.childReport).success).toBe(true);
  for (const inventory of value.inventories) expect(WorkflowAcceptanceRuntimeInventory.safeParse(inventory).success).toBe(true);
}
function expectUnconfirmed(result: WorkflowAcceptanceRuntimeCoverageEvaluation, failure: WorkflowAcceptanceRuntimeCoverageFailure) {
  expect(result.status).toBe("unconfirmed"); expect(result.cleanupPermitted).toBe(false);
  expect(result.failures).toContain(failure);
  expect(result.counts).toEqual({ processes: null, nodeProcesses: null, launches: null, realms: null, pools: null });
  expect(WorkflowAcceptanceRuntimeCoverageEvaluation.safeParse(result).success).toBe(true);
}

function poolsFixture(poolsPerRealm: number, extra = 0): Fixture {
  const value = fixture([100], 64);
  for (const [index, realm] of value.inventories[0].realms.entries()) {
    realm.poolCreationIds = Array.from({ length: poolsPerRealm + (index < extra ? 1 : 0) }, (_, poolIndex) => id(100 * 32768 + index * 128 + poolIndex, "5"));
    realm.poolCloseReceipt = completed(realm.poolCreationIds);
  }
  value.childReport = child(value.inventories[0]);
  return value;
}
function atByteBoundary(): Fixture {
  const bytes = (value: Fixture) => Buffer.byteLength(JSON.stringify(value.inventories[0]), "utf8");
  let low = 0, high = 128;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (bytes(poolsFixture(middle)) <= MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES) low = middle; else high = middle - 1;
  }
  expect(low).toBeLessThan(128);
  let result = poolsFixture(low);
  for (let extra = 1; extra < 64; extra++) {
    const next = poolsFixture(low, extra);
    if (bytes(next) > MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES) break;
    result = next;
  }
  const remaining = MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES - bytes(result);
  expect(remaining).toBeLessThan(2040);
  const sdkDirectory = result.request.context.sdkDirectory + "x".repeat(remaining);
  result.request.context.sdkDirectory = sdkDirectory; result.processInventory.context.sdkDirectory = sdkDirectory;
  result.childReport.context.sdkDirectory = sdkDirectory; result.inventories[0].launch.context.sdkDirectory = sdkDirectory;
  expect(bytes(result)).toBe(MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES);
  return result;
}

describe("完整运行清单的纯集合校验", () => {
  it("匹配进程、空间和池的完整集合，但始终不授予清理", () => {
    const value = fixture(); expectValid(value);
    expect(evaluate(value)).toEqual({ version: 2, status: "consistent", cleanupPermitted: false, failures: [],
      counts: { processes: 2, nodeProcesses: 1, launches: 1, realms: 2, pools: 2 } });
    expect(evaluate(value)).not.toHaveProperty("coverageComplete");
  });
  it("多 Node 和原生服务都保留，只有 Node 必须具有唯一启动清单", () => {
    const value = fixture([100, 101]); expectValid(value);
    expect(evaluate(value).counts).toEqual({ processes: 3, nodeProcesses: 2, launches: 2, realms: 4, pools: 4 });
    expect(evaluate(value).status).toBe("consistent");
  });
  it("业务子报告来自实际 worker，不要求来自父根 PID", () => {
    const value = fixture([100, 101]); value.childReport = child(value.inventories[1]); expectValid(value);
    expect(value.childReport.realms[0].processId).not.toBe(value.processInventory.rootProcessId);
    expect(evaluate(value).status).toBe("consistent");
  });
  it("子报告只保留合法子集，17 个实际空间不截断为 16", () => {
    const value = fixture([100], 17); expectValid(value);
    expect(value.childReport.realms).toHaveLength(1); expect(evaluate(value).counts.realms).toBe(17);
    expect(evaluate(value).status).toBe("consistent");
    value.inventories[0].realms[16].poolCloseReceipt = null; expectValid(value);
    expectUnconfirmed(evaluate(value), "pool-close-unconfirmed");
  });
  it("保留 64 启动各 256 空间的计数上界，不以子报告回填全集", () => {
    const value = fixture(Array.from({ length: 64 }, (_, index) => 100 + index), 256, false);
    expect(evaluate(value)).toEqual({ version: 2, status: "consistent", cleanupPermitted: false, failures: [],
      counts: { processes: 64, nodeProcesses: 64, launches: 64, realms: 16384, pools: 16384 } });
  });
  it("集合和回执数组可重排，原始文件哈希仍只作为请求而非运行证明", () => {
    const value = fixture([100, 101]), realm = value.inventories[0].realms[1];
    realm.poolCreationIds.push(id(9999, "5")); realm.poolCloseReceipt = completed(realm.poolCreationIds);
    value.childReport = child(value.inventories[0]); value.childReport.realms[0].pools.poolIds.reverse();
    value.childReport.realms[0].pools.completedIds.reverse(); value.inventories.reverse();
    value.request.ownedProcessIds.reverse(); value.request.runtimeInventoryRefs.reverse(); value.processInventory.members.reverse();
    expectValid(value); expect(evaluate(value).status).toBe("consistent"); expect(evaluate(value).counts.pools).toBe(5);
  });
  it.each(["missing", "extra", "duplicate-pid", "duplicate-launch", "thread", "native-pid", "missing-ref", "extra-ref", "missing-owned", "extra-owned"] as const)("拒绝启动全集不一致 %s", (mode) => {
    const value = fixture([100, 101]);
    if (mode === "missing") value.inventories.pop();
    if (mode === "extra") value.inventories.push(runtime(102));
    if (mode === "duplicate-pid") value.inventories[1].launch.processId = 100;
    if (mode === "duplicate-launch") value.inventories[1].launch.launchId = value.inventories[0].launch.launchId;
    if (mode === "thread") value.inventories[1].launch.threadId = 1;
    if (mode === "native-pid") value.inventories[1].launch.processId = 9000;
    if (mode === "missing-ref") value.request.runtimeInventoryRefs.pop();
    if (mode === "extra-ref") value.request.runtimeInventoryRefs.push({ launchId: id(102, "2"), sha256: "3".repeat(64) });
    if (mode === "missing-owned") value.request.ownedProcessIds.pop();
    if (mode === "extra-owned") value.request.ownedProcessIds.push(9999);
    expectValid(value); expectUnconfirmed(evaluate(value), "launch-set-mismatch");
  });
  it.each(["unknown", "forced", "stdout", "stderr", "incomplete", "exit", "unknown-image", "no-stop", "bridge", "migration"] as const)("拒绝未确认的自然退出和非业务阶段 %s", (mode) => {
    const value = fixture(), process = value.processInventory;
    process.observationStatus = "unknown";
    if (mode === "unknown") process.termination = "unknown";
    if (mode === "forced") process.termination = "forced";
    if (mode === "stdout") process.stdoutEof = false;
    if (mode === "stderr") process.stderrEof = false;
    if (mode === "incomplete") { process.inventoryComplete = false; process.totalProcesses = null; process.remainingOwnedProcesses = null; }
    if (mode === "exit") { process.inventoryComplete = false; process.members[1].exitCode = 1; }
    if (mode === "unknown-image") { process.members[1].image = null; process.members[1].imageObservationStatus = "unknown"; }
    if (mode === "no-stop") process.stoppedAt = null;
    if (mode === "bridge" || mode === "migration") { process.phase = mode; process.observationStatus = "observed"; }
    expectValid(value); expectUnconfirmed(evaluate(value), "process-exit-unconfirmed");
  });
  it.each(["version", "batchId", "caseId", "sourceCommit", "sourceFingerprint", "executionDomainId", "databaseBranchId", "applicationName", "sdkDirectory"] as const)("上下文全部字段必须匹配 %s", (key) => {
    const value = fixture(), alternate = context();
    if (key === "version") {
      Object.defineProperty(value.childReport.context, key, { value: 2, enumerable: true });
      expectUnconfirmed(evaluate(value), "invalid-child-report"); return;
    }
    if (key === "batchId") alternate.batchId = id(3, "1");
    if (key === "caseId") alternate.caseId = "harness-frozen-denial";
    if (key === "sourceCommit") alternate.sourceCommit = "e".repeat(40);
    if (key === "sourceFingerprint") alternate.sourceFingerprint = "f".repeat(64);
    if (key === "executionDomainId" || key === "applicationName") {
      alternate.executionDomainId = id(3, "1"); alternate.applicationName = `mvp_wf_${alternate.executionDomainId.replaceAll("-", "")}`;
      value.childReport.realms[0].executionDomainId = alternate.executionDomainId;
      value.childReport.realms[0].pools.ownerId = alternate.executionDomainId;
    }
    if (key === "databaseBranchId") alternate.databaseBranchId = "br-different";
    if (key === "sdkDirectory") alternate.sdkDirectory = "D:/other/sdk";
    value.childReport.context = alternate; expectValid(value); expectUnconfirmed(evaluate(value), "context-mismatch");
  });
  it.each(["process", "runtime"] as const)("父清单和每个启动上下文不能借子报告匹配 %s", (mode) => {
    const value = fixture();
    if (mode === "process") value.processInventory.context.sdkDirectory = "D:/other/sdk";
    else value.inventories[0].launch.context.sdkDirectory = "D:/other/sdk";
    expectValid(value); expectUnconfirmed(evaluate(value), "context-mismatch");
  });
  it.each(["adapterFingerprint", "sdkFactoryFingerprint"] as const)("每个启动须匹配独立预期指纹 %s", (key) => {
    const value = fixture([100, 101]); value.inventories[1].launch[key] = "e".repeat(64);
    expectValid(value); expectUnconfirmed(evaluate(value), "source-fingerprint-mismatch");
  });
  it.each(["before-parent", "after-parent"] as const)("启动和最终收集必须处于真实父生命周期 %s", (mode) => {
    const value = fixture();
    if (mode === "before-parent") value.inventories[0].launch.startedAt = at(0);
    else value.inventories[0].collectedAt = at(10);
    expectValid(value); expectUnconfirmed(evaluate(value), "runtime-lifecycle-unconfirmed");
  });
  it.each(["pending", "failed", "handler", "dispatch", "seal"] as const)("未完成创建、处理或封闭不能虚标完整 %s", (mode) => {
    const value = fixture(), inventory = value.inventories[0], creationId = id(9999, "4");
    if (mode === "pending" || mode === "failed") {
      inventory.creationEvents.push({ sequence: 5, creationId, factory: "node-vm", phase: "started", parentRealmId: inventory.realms[0].realmId,
        realmId: null, at: at(5), failureCode: null });
      if (mode === "pending") inventory.pendingCreationIds = [creationId];
      else { inventory.creationEvents.push({ ...inventory.creationEvents[4], sequence: 6, phase: "failed", failureCode: "native-creation" }); inventory.failedCreationIds = [creationId]; }
      inventory.creationsSealedAfterEventSequence = inventory.creationEvents.length;
    }
    if (mode === "handler") {
      inventory.handlers[0].settledAt = null; inventory.handlers[0].result = "unknown"; inventory.unfinishedHandlerIds = [inventory.handlers[0].handlerId];
    }
    if (mode === "dispatch") { inventory.dispatchStoppedAt = null; inventory.dispatchStoppedAfterHandlerSequence = null; }
    if (mode === "seal") { inventory.creationsSealedAt = null; inventory.creationsSealedAfterEventSequence = null; }
    expectValid(value); expectUnconfirmed(evaluate(value), "runtime-lifecycle-unconfirmed");
  });
  it("已真实结束的 rejected 处理可以记录，业务通过仍由原子报告独立确认", () => {
    const value = fixture(); value.inventories[0].handlers[0].result = "rejected";
    expectValid(value); expect(evaluate(value).status).toBe("consistent");
  });
  it.each(["no-host", "two-hosts", "quickjs", "orphan"] as const)("固定 Node 配置的实际空间集合不能含未知配置 %s", (mode) => {
    const value = fixture(), inventory = value.inventories[0], index = mode === "no-host" ? 0 : 1;
    const factory = mode === "quickjs" ? "quickjs" as const : mode === "two-hosts" ? "host" as const : "node-vm" as const;
    inventory.realms[index].factory = factory;
    if (factory === "host" || mode === "orphan") inventory.realms[index].parentRealmId = null;
    for (const event of inventory.creationEvents.slice(index * 2, index * 2 + 2)) {
      event.factory = factory; if (factory === "host" || mode === "orphan") event.parentRealmId = null;
    }
    expectValid(value); expectUnconfirmed(evaluate(value), "realm-set-mismatch");
  });
  it("每份清单独立允许 512KiB，超出的真实 UTF8 数据拒绝", () => {
    const value = atByteBoundary(); expectValid(value); expect(evaluate(value).status).toBe("consistent");
    for (const current of [value.request.context, value.processInventory.context, value.childReport.context, value.inventories[0].launch.context]) current.sdkDirectory += "界";
    expect(Buffer.byteLength(JSON.stringify(value.inventories[0]), "utf8")).toBe(MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES + 3);
    expectUnconfirmed(evaluate(value), "invalid-runtime-inventory");
  });
  it("多份合法清单不共享 512KiB 总容量，仍逐份校验", () => {
    const value = fixture([100, 101], 64);
    for (const inventory of value.inventories) for (const [index, realm] of inventory.realms.entries()) {
      realm.poolCreationIds = Array.from({ length: 45 }, (_, poolIndex) => id(inventory.launch.processId * 32768 + index * 128 + poolIndex, "5"));
      realm.poolCloseReceipt = completed(realm.poolCreationIds);
    }
    value.childReport = child(value.inventories[0]);
    const sizes = value.inventories.map((inventory) => Buffer.byteLength(JSON.stringify(inventory), "utf8"));
    expect(sizes.every((size) => size <= MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES)).toBe(true);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeGreaterThan(MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES);
    expectValid(value); expect(evaluate(value).status).toBe("consistent"); expect(evaluate(value).counts.pools).toBe(5760);
  });
  it("零池也必须有实际完成回执，而不是 null", () => {
    const value = fixture();
    for (const realm of value.inventories[0].realms) { realm.poolCreationIds = []; realm.poolCloseReceipt = completed([]); }
    value.childReport = child(value.inventories[0]); expectValid(value);
    expect(evaluate(value).status).toBe("consistent"); expect(evaluate(value).counts.pools).toBe(0);
    value.inventories[0].realms[0].poolCloseReceipt = null; expectValid(value); expectUnconfirmed(evaluate(value), "pool-close-unconfirmed");
  });
  it("封闭之后原创建可返回，已派发处理可结算，不伪造新启动时刻", () => {
    const value = fixture(), inventory = value.inventories[0];
    inventory.creationEvents[3].at = at(8); inventory.creationsSealedAfterEventSequence = 3; inventory.handlers[0].settledAt = at(8);
    expectValid(value); expect(evaluate(value).status).toBe("consistent");
  });
  it.each(["missing", "closing", "failed", "unknown"] as const)("每个真实空间必须具有完整池回执 %s", (mode) => {
    const value = fixture(), realm = value.inventories[0].realms[0], receipt = realm.poolCloseReceipt!;
    if (mode === "missing") realm.poolCloseReceipt = null;
    if (mode === "closing") receipt.state = "closing";
    if (mode === "failed" || mode === "unknown") {
      receipt.state = "callback_failed"; receipt.completedIds = [];
      if (mode === "failed") receipt.failedIds = [...receipt.poolIds]; else receipt.unknownIds = [...receipt.poolIds];
    }
    expectValid(value); expectUnconfirmed(evaluate(value), "pool-close-unconfirmed");
  });
  it.each(["realm", "pool"] as const)("跨启动空间和池标识也必须全局唯一 %s", (mode) => {
    const value = fixture([100, 101]), first = value.inventories[0], second = value.inventories[1];
    if (mode === "realm") {
      const original = second.realms[0].realmId, duplicate = first.realms[0].realmId;
      second.realms[0].realmId = duplicate;
      for (const realm of second.realms) if (realm.parentRealmId === original) realm.parentRealmId = duplicate;
      for (const event of second.creationEvents) {
        if (event.realmId === original) event.realmId = duplicate;
        if (event.parentRealmId === original) event.parentRealmId = duplicate;
      }
    } else {
      second.realms[0].poolCreationIds = [...first.realms[0].poolCreationIds]; second.realms[0].poolCloseReceipt = completed(second.realms[0].poolCreationIds);
    }
    expectValid(value); expectUnconfirmed(evaluate(value), mode === "realm" ? "realm-set-mismatch" : "pool-close-unconfirmed");
  });
  it.each(["empty", "failed", "unknown"] as const)("原业务子报告仍须真实通过且含非空空间 %s", (mode) => {
    const value = fixture();
    if (mode === "empty") value.childReport.realms = [];
    else { value.childReport.businessStatus = mode; value.childReport.failureCode = mode === "failed" ? "business" : "unknown"; }
    expectValid(value); expectUnconfirmed(evaluate(value), "business-unconfirmed");
  });
  it.each(["realm", "pid", "thread", "state", "pools", "failed", "unknown"] as const)("子报告须与完整空间回执逐字段等价 %s", (mode) => {
    const value = fixture(), receipt = value.childReport.realms[0];
    if (mode === "realm") receipt.realmId = id(9999, "3");
    if (mode === "pid") receipt.processId = 9999;
    if (mode === "thread") receipt.threadId = 1;
    if (mode === "state") receipt.pools.state = "closing";
    if (mode === "pools") { receipt.pools.poolIds = [id(9999, "5")]; receipt.pools.completedIds = [...receipt.pools.poolIds]; }
    if (mode === "failed" || mode === "unknown") {
      receipt.pools.state = "callback_failed"; receipt.pools.completedIds = [];
      if (mode === "failed") receipt.pools.failedIds = [...receipt.pools.poolIds]; else receipt.pools.unknownIds = [...receipt.pools.poolIds];
    }
    expectValid(value); expectUnconfirmed(evaluate(value), "child-receipt-mismatch");
  });
  it("子报告仍有 16 项上限，不能把扩展全集伪装为原报告", () => {
    const value = fixture([100], 17);
    value.childReport.realms = value.inventories[0].realms.map((realm) => ({ realmId: realm.realmId, executionDomainId: owner, processId: 100, threadId: 0,
      pools: structuredClone(realm.poolCloseReceipt!) }));
    expectUnconfirmed(evaluate(value), "invalid-child-report");
  });
  it.each(["request", "process", "child", "runtime"] as const)("未知输入不产生任何部分计数 %s", (mode) => {
    const value = fixture();
    const result = evaluateWorkflowRuntimeCoverage(mode === "request" ? null : value.request, mode === "process" ? null : value.processInventory,
      mode === "child" ? null : value.childReport, mode === "runtime" ? [null] : value.inventories);
    const failure: WorkflowAcceptanceRuntimeCoverageFailure = mode === "request" ? "invalid-request" : mode === "process" ? "invalid-process-inventory"
      : mode === "child" ? "invalid-child-report" : "invalid-runtime-inventory";
    expectUnconfirmed(result, failure);
  });
  it.each(["empty", "65", "sparse", "record", "symbol"] as const)("外层清单先校验原生密集数组及 1..64 边界 %s", (mode) => {
    const value = fixture(); let raw: unknown = [];
    if (mode === "65") raw = Array.from({ length: 65 }, () => value.inventories[0]);
    if (mode === "sparse") raw = new Array(1);
    if (mode === "record") raw = { 0: value.inventories[0], length: 1 };
    if (mode === "symbol") { raw = [...value.inventories]; Object.defineProperty(raw, Symbol("extra"), { value: 1 }); }
    expectUnconfirmed(evaluateWorkflowRuntimeCoverage(value.request, value.processInventory, value.childReport, raw), "invalid-runtime-inventory");
  });
  it("外层索引 getter 不被读取", () => {
    const value = fixture(), getter = vi.fn(() => value.inventories[0]), raw: unknown[] = [];
    Object.defineProperty(raw, "0", { get: getter, enumerable: true });
    expectUnconfirmed(evaluateWorkflowRuntimeCoverage(value.request, value.processInventory, value.childReport, raw), "invalid-runtime-inventory");
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(["request", "process", "child", "runtime", "outer"] as const)("输入 Proxy 在任何 trap 之前拒绝 %s", (mode) => {
    const value = fixture(), trap = vi.fn(() => { throw new Error("must not run"); });
    const proxy = (raw: object) => new Proxy(raw, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    expectUnconfirmed(evaluateWorkflowRuntimeCoverage(mode === "request" ? proxy(value.request) : value.request,
      mode === "process" ? proxy(value.processInventory) : value.processInventory, mode === "child" ? proxy(value.childReport) : value.childReport,
      mode === "outer" ? proxy(value.inventories) : mode === "runtime" ? [proxy(value.inventories[0])] : value.inventories),
    mode === "request" ? "invalid-request" : mode === "process" ? "invalid-process-inventory" : mode === "child" ? "invalid-child-report" : "invalid-runtime-inventory");
    expect(trap).not.toHaveBeenCalled();
  });
  it.each(["child-field", "runtime-field", "constructor-prototype", "prototype-proxy"] as const)("输入字段与构造原型访问器不执行 %s", (mode) => {
    const value = fixture(), getter = vi.fn(() => { throw new Error("must not run"); });
    if (mode === "child-field") Object.defineProperty(value.childReport, "businessStatus", { get: getter, enumerable: true });
    if (mode === "runtime-field") Object.defineProperty(value.inventories[0].launch, "processId", { get: getter, enumerable: true });
    if (mode === "constructor-prototype") {
      const constructor = () => undefined;
      Object.defineProperty(constructor, "prototype", { get: getter });
      Object.setPrototypeOf(value.childReport, Object.create(null, { constructor: { value: constructor } }));
    }
    if (mode === "prototype-proxy") Object.setPrototypeOf(value.childReport, new Proxy(Object.prototype, { getPrototypeOf: getter, getOwnPropertyDescriptor: getter }));
    expectUnconfirmed(evaluate(value), mode === "runtime-field" ? "invalid-runtime-inventory" : "invalid-child-report");
    expect(getter).not.toHaveBeenCalled();
  });
  it("独立原生 VM 的缺字段继承 getter 不会穿过旧 child schema", () => {
    const value = fixture(), getter = vi.fn(() => "passed"), sandbox = { getter, serialized: JSON.stringify(value.childReport) };
    const raw: unknown = runInNewContext(`const value = JSON.parse(serialized); delete value.businessStatus;
      Object.defineProperty(Object.prototype, 'businessStatus', { get: getter }); value`, sandbox);
    expectUnconfirmed(evaluateWorkflowRuntimeCoverage(value.request, value.processInventory, raw, value.inventories), "invalid-child-report");
    expect(getter).not.toHaveBeenCalled();
  });
  it("独立 VM 的继承 toJSON 访问器不影响合法子报告也不被执行", () => {
    const value = fixture(), getter = vi.fn(() => { throw new Error("must not run"); });
    const raw: unknown = runInNewContext(`Object.defineProperty(Object.prototype, 'toJSON', { get: getter }); JSON.parse(serialized)`,
      { getter, serialized: JSON.stringify(value.childReport) });
    expect(evaluateWorkflowRuntimeCoverage(value.request, value.processInventory, raw, value.inventories).status).toBe("consistent");
    expect(getter).not.toHaveBeenCalled();
  });
  it("跨原生 VM 的普通数据和外层密集数组仍可匹配", () => {
    const value = fixture(), raw: unknown[] = runInNewContext("JSON.parse(serialized)", { serialized: JSON.stringify([
      value.request, value.processInventory, value.childReport, value.inventories]) });
    expect(evaluateWorkflowRuntimeCoverage(raw[0], raw[1], raw[2], raw[3]).status).toBe("consistent");
  });
});
