import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  WorkflowAcceptanceRuntimeCoverageEvaluation, WorkflowAcceptanceRuntimeObservationRequest,
  WorkflowAcceptanceRuntimeFingerprints, WORKFLOW_EXPECTED_FINGERPRINTS_FILE,
  WORKFLOW_RUNTIME_OBSERVATION_REQUEST_FILE, WORKFLOW_RUNTIME_COVERAGE_EVALUATION_FILE,
  WORKFLOW_BUSINESS_PROCESS_INVENTORY_FILE, WORKFLOW_BUSINESS_CHILD_REPORT_FILE, WORKFLOW_RUNTIME_INVENTORY_DIRECTORY,
} from "./workflow-runtime-observation";

const id = (index: number) => `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
function fixture(): WorkflowAcceptanceRuntimeObservationRequest {
  const owner = id(1), batchId = id(2), sourceCommit = "a".repeat(40), sourceFingerprint = "b".repeat(64);
  return {
    version: 2, operation: "observe-runtime", caseDirectory: "D:/owned/case",
    context: { version: 1, batchId, caseId: "harness-retry", sourceCommit, sourceFingerprint, executionDomainId: owner,
      databaseBranchId: "br-owned", applicationName: `mvp_wf_${owner.replaceAll("-", "")}`, sdkDirectory: "D:/owned/case/sdk" },
    provenance: { version: 1, projectId: "owned-project", databaseBranchId: "br-owned", branchName: `mvp-wf-${owner}`,
      executionDomainId: owner, batchId, sourceCommit, sourceFingerprint, createdAt: "2026-10-14T00:00:00.000Z",
      endpointId: "ep-owned", endpointHost: "ep-owned.us-east-2.aws.neon.tech", databaseName: "ci_test", creationRequestId: "owned-request",
      databaseId: 1, databaseCreatedAt: "2026-10-14T00:00:01.000Z", databaseOwner: "neondb_owner", parentBranchId: "br-parent" },
    ownedProcessIds: [100, 101], processInventoryRef: { sha256: "c".repeat(64) }, childReportRef: { sha256: "d".repeat(64) },
    runtimeInventoryRefs: [{ launchId: id(3), sha256: "e".repeat(64) }],
    expectedFingerprints: { adapterFingerprint: "f".repeat(64), sdkFactoryFingerprint: "0".repeat(64) },
  };
}
function consistent(): WorkflowAcceptanceRuntimeCoverageEvaluation {
  return { version: 2, status: "consistent", cleanupPermitted: false, failures: [],
    counts: { processes: 2, nodeProcesses: 1, launches: 1, realms: 17, pools: 17 } };
}

describe("父探针与运行读取器的共享指纹", () => {
  it("复用请求中的两项指纹及固定文件名，不增加自报许可", () => {
    const fingerprints = fixture().expectedFingerprints;
    expect(WorkflowAcceptanceRuntimeFingerprints.parse(fingerprints)).toEqual(
      WorkflowAcceptanceRuntimeObservationRequest.parse(fixture()).expectedFingerprints,
    );
    expect(WORKFLOW_EXPECTED_FINGERPRINTS_FILE).toBe("expected-fingerprints.json");
    expect(WORKFLOW_RUNTIME_OBSERVATION_REQUEST_FILE).toBe("observe-runtime-request.json");
    expect(WORKFLOW_RUNTIME_COVERAGE_EVALUATION_FILE).toBe("runtime-coverage-evaluation.json");
    expect(Object.keys(WorkflowAcceptanceRuntimeFingerprints.parse(fingerprints)).sort()).toEqual(["adapterFingerprint", "sdkFactoryFingerprint"]);
  });
  it.each(["missing-adapter", "missing-sdk", "unknown-field", "uppercase", "short", "non-string", "non-object"])("拒绝无效独立指纹 %s", (mode) => {
    const value: Record<string, unknown> = { ...fixture().expectedFingerprints };
    if (mode === "missing-adapter") delete value.adapterFingerprint;
    if (mode === "missing-sdk") delete value.sdkFactoryFingerprint;
    if (mode === "unknown-field") value.cleanupPermitted = true;
    if (mode === "uppercase") value.adapterFingerprint = "A".repeat(64);
    if (mode === "short") value.sdkFactoryFingerprint = "a".repeat(63);
    if (mode === "non-string") value.adapterFingerprint = 1;
    expect(WorkflowAcceptanceRuntimeFingerprints.safeParse(mode === "non-object" ? null : value).success).toBe(false);
  });
  it("独立解析不执行指纹访问器", () => {
    const value = fixture().expectedFingerprints, getter = vi.fn(() => "f".repeat(64));
    Object.defineProperty(value, "adapterFingerprint", { enumerable: true, get: getter });
    expect(WorkflowAcceptanceRuntimeFingerprints.safeParse(value).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it("独立解析接受其他原生执行空间的普通记录", () => {
    const fingerprints = fixture().expectedFingerprints;
    expect(WorkflowAcceptanceRuntimeFingerprints.parse(runInNewContext(`(${JSON.stringify(fingerprints)})`))).toEqual(fingerprints);
  });
  it("独立解析拒绝 constructor 访问器，不执行调用者代码", () => {
    const value = fixture().expectedFingerprints, getter = vi.fn(), prototype = Object.create(null);
    Object.defineProperty(prototype, "constructor", { get: getter });
    Object.setPrototypeOf(value, prototype);
    expect(WorkflowAcceptanceRuntimeFingerprints.safeParse(value).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it("独立解析拒绝自定义序列化函数，不调用 toJSON", () => {
    const toJSON = vi.fn(() => fixture().expectedFingerprints);
    expect(WorkflowAcceptanceRuntimeFingerprints.safeParse({ ...fixture().expectedFingerprints, toJSON }).success).toBe(false);
    expect(toJSON).not.toHaveBeenCalled();
  });
});

describe("完整运行观察的独立共享契约", () => {
  it("固定原文件布局只输出引用，不携带伪造的实际观察布尔值", () => {
    const value = WorkflowAcceptanceRuntimeObservationRequest.parse(fixture());
    expect(value.ownedProcessIds).toEqual([100, 101]);
    expect(value.processInventoryRef).toEqual({ sha256: "c".repeat(64) });
    expect(WORKFLOW_BUSINESS_PROCESS_INVENTORY_FILE).toBe("business-process-inventory.json");
    expect(WORKFLOW_BUSINESS_CHILD_REPORT_FILE).toBe("child-result.json");
    expect(WORKFLOW_RUNTIME_INVENTORY_DIRECTORY).toBe("runtime-inventory");
    expect(value).not.toHaveProperty("allRealmReceiptsCollected");
  });
  it("最多64份引擎原文件，包含全部64进程，不把原生子进程过滤掉", () => {
    const value = fixture(); value.ownedProcessIds = Array.from({ length: 64 }, (_, index) => 100 + index);
    value.runtimeInventoryRefs = Array.from({ length: 64 }, (_, index) => ({ launchId: id(index + 10), sha256: "e".repeat(64) }));
    expect(WorkflowAcceptanceRuntimeObservationRequest.parse(value).runtimeInventoryRefs).toHaveLength(64);
  });
  it.each(["empty-process", "duplicate-process", "too-many-process", "empty-runtime", "duplicate-runtime", "too-many-runtime", "invalid-id", "uppercase-hash"])("拒绝无界或不唯一引用 %s", (mode) => {
    const value = fixture();
    if (mode === "empty-process") value.ownedProcessIds = [];
    if (mode === "duplicate-process") value.ownedProcessIds = [100, 100];
    if (mode === "too-many-process") value.ownedProcessIds = Array.from({ length: 65 }, (_, index) => index + 1);
    if (mode === "empty-runtime") value.runtimeInventoryRefs = [];
    if (mode === "duplicate-runtime") value.runtimeInventoryRefs.push({ ...value.runtimeInventoryRefs[0] });
    if (mode === "too-many-runtime") value.runtimeInventoryRefs = Array.from({ length: 65 }, (_, index) => ({ launchId: id(index + 10), sha256: "e".repeat(64) }));
    if (mode === "invalid-id") value.runtimeInventoryRefs[0].launchId = "../../other";
    if (mode === "uppercase-hash") value.processInventoryRef.sha256 = "A".repeat(64);
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse(value).success).toBe(false);
  });
  it("启动标识大小写归一后仍须唯一", () => {
    const value = fixture(), launchId = id(0xabc);
    value.runtimeInventoryRefs = [{ launchId, sha256: "e".repeat(64) }, { launchId: launchId.toUpperCase(), sha256: "e".repeat(64) }];
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse(value).success).toBe(false);
  });
  it.each(["batchId", "sourceCommit", "sourceFingerprint", "databaseBranchId"] as const)("创建归属 %s 不能混入其他案例", (key) => {
    const value = fixture();
    Object.assign(value.provenance, { [key]: key === "batchId" ? id(9) : key === "sourceCommit" ? "c".repeat(40)
      : key === "sourceFingerprint" ? "d".repeat(64) : "br-other" });
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse(value).success).toBe(false);
  });
  it("创建执行域连同分支名更换也不能绕过冻结上下文", () => {
    const value = fixture(); value.provenance.executionDomainId = id(9); value.provenance.branchName = `mvp-wf-${id(9)}`;
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse(value).success).toBe(false);
  });
  it.each(["relative", "D:/owned/../case", "D:/owned//case", "//server/case", "D:/case:stream", "D:/bad\"/case"])("拒绝任意路径 %s", (caseDirectory) => {
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse({ ...fixture(), caseDirectory }).success).toBe(false);
  });
  it.each(["cleanupPermitted", "allRealmReceiptsCollected", "databaseSnapshotFresh", "databaseUrl", "apiKey", "processObservation"])("不能预先声明许可、秘密或派生状态 %s", (key) => {
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse({ ...fixture(), [key]: true }).success).toBe(false);
  });
  it("引用不得提供自报字节长度、路径或重复进程身份", () => {
    const value = fixture();
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse({ ...value, processInventoryRef: { ...value.processInventoryRef, byteLength: 1 } }).success).toBe(false);
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse({ ...value, childReportRef: { ...value.childReportRef, path: "D:/other.json" } }).success).toBe(false);
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse({ ...value, runtimeInventoryRefs: [{ ...value.runtimeInventoryRefs[0], processId: 100 }] }).success).toBe(false);
  });
  it("被动镜像拒绝自身访问器，不执行 getter", () => {
    const getter = vi.fn(), value = fixture(); Object.defineProperty(value, "context", { get: getter, enumerable: true });
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse(value).success).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it("拒绝符号、循环、稀疏数组和自定义索引属性", () => {
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse({ ...fixture(), [Symbol("extra")]: true }).success).toBe(false);
    const cycle = fixture(); Object.assign(cycle, { self: cycle });
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse(cycle).success).toBe(false);
    const sparse = fixture(); sparse.ownedProcessIds = new Array(2); sparse.ownedProcessIds[0] = 100;
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse(sparse).success).toBe(false);
    const extra = fixture(); Object.assign(extra.runtimeInventoryRefs, { other: true });
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse(extra).success).toBe(false);
  });
  it("接受其他原生执行空间的普通JSON，但不调用其toJSON", () => {
    const crossRealm = runInNewContext(`(${JSON.stringify(fixture())})`);
    expect(WorkflowAcceptanceRuntimeObservationRequest.parse(crossRealm)).toEqual(fixture());
    const getter = vi.fn(), value = fixture();
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    try {
      Object.defineProperty(Object.prototype, "toJSON", { get: getter, configurable: true });
      expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse(value).success).toBe(true); expect(getter).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(Object.prototype, "toJSON", original); else delete (Object.prototype as { toJSON?: unknown }).toJSON;
    }
  });
  it("自定义原型的constructor访问器不会被读取", () => {
    const getter = vi.fn(), value = fixture(), prototype = Object.create(null);
    Object.defineProperty(prototype, "constructor", { get: getter }); Object.setPrototypeOf(value, prototype);
    expect(WorkflowAcceptanceRuntimeObservationRequest.safeParse(value).success).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it("集合一致只是有限计数，不升级为实际观察或清理许可", () => {
    expect(WorkflowAcceptanceRuntimeCoverageEvaluation.parse(consistent()).counts.realms).toBe(17);
    expect(WorkflowAcceptanceRuntimeCoverageEvaluation.safeParse({ ...consistent(), cleanupPermitted: true }).success).toBe(false);
    expect(WorkflowAcceptanceRuntimeCoverageEvaluation.safeParse({ ...consistent(), status: "observed" }).success).toBe(false);
  });
  it("完整容量允许64×256空间，不能缩减成旧报告的16", () => {
    const value = consistent(); value.counts = { processes: 64, nodeProcesses: 64, launches: 64, realms: 16_384, pools: 2_097_152 };
    expect(WorkflowAcceptanceRuntimeCoverageEvaluation.safeParse(value).success).toBe(true);
    value.counts.realms = 16_385; expect(WorkflowAcceptanceRuntimeCoverageEvaluation.safeParse(value).success).toBe(false);
  });
  it("未确认必须有唯一失败原因且所有数量保持未知", () => {
    const value: WorkflowAcceptanceRuntimeCoverageEvaluation = { version: 2, status: "unconfirmed", cleanupPermitted: false,
      failures: ["process-exit-unconfirmed"], counts: { processes: null, nodeProcesses: null, launches: null, realms: null, pools: null } };
    expect(WorkflowAcceptanceRuntimeCoverageEvaluation.safeParse(value).success).toBe(true);
    expect(WorkflowAcceptanceRuntimeCoverageEvaluation.safeParse({ ...value, failures: [] }).success).toBe(false);
    expect(WorkflowAcceptanceRuntimeCoverageEvaluation.safeParse({ ...value, failures: [...value.failures, ...value.failures] }).success).toBe(false);
    expect(WorkflowAcceptanceRuntimeCoverageEvaluation.safeParse({ ...value, counts: { ...value.counts, pools: 0 } }).success).toBe(false);
  });
  it.each(["missing-count", "no-node", "missing-launch", "more-nodes-than-processes", "missing-host", "too-many-realms-per-launch", "too-many-pools-per-realm", "failure"])("一致结果不接受矛盾数量 %s", (mode) => {
    const value = consistent();
    if (mode === "missing-count") value.counts.pools = null;
    if (mode === "no-node") value.counts.nodeProcesses = 0;
    if (mode === "missing-launch") value.counts.launches = 0;
    if (mode === "more-nodes-than-processes") value.counts.processes = 0;
    if (mode === "missing-host") value.counts.realms = 0;
    if (mode === "too-many-realms-per-launch") value.counts.realms = 257;
    if (mode === "too-many-pools-per-realm") { value.counts.realms = 1; value.counts.pools = 129; }
    if (mode === "failure") value.failures = ["business-unconfirmed"];
    expect(WorkflowAcceptanceRuntimeCoverageEvaluation.safeParse(value).success).toBe(false);
  });
});
