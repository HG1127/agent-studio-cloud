import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import {
  MAX_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_BYTES, MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES,
  WorkflowAcceptanceBridgeRequest, WorkflowAcceptanceObservedRecord, WorkflowAcceptanceOwnedBranchProvenance,
  MAX_WORKFLOW_ACCEPTANCE_PREPARATION_REQUEST_BYTES, WorkflowAcceptanceCasePreparationRequest,
  MAX_WORKFLOW_ACCEPTANCE_EMPTY_DATABASE_OBSERVATION_BYTES, WorkflowAcceptanceEmptyDatabaseObservation,
} from "./workflow-acceptance-bridge";
import { WorkflowAcceptanceCaseId } from "./workflow-case-acceptance";
import type { WorkflowAcceptanceContext, WorkflowAcceptanceCleanupReceipt } from "./workflow-case-acceptance";

const owner = "11111111-1111-4111-8111-111111111111";
function context(): WorkflowAcceptanceContext {
  return { version: 1, batchId: "22222222-2222-4222-8222-222222222222", caseId: "harness-retry",
    sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), executionDomainId: owner,
    databaseBranchId: "br-own-case", applicationName: `mvp_wf_${owner.replaceAll("-", "")}`, sdkDirectory: "D:/owned/case/sdk" };
}
function provenance(): WorkflowAcceptanceOwnedBranchProvenance {
  return { version: 1, projectId: "example-project-1234", databaseBranchId: context().databaseBranchId,
    branchName: `mvp-wf-${owner}`, executionDomainId: owner, batchId: context().batchId,
    sourceCommit: context().sourceCommit, sourceFingerprint: context().sourceFingerprint,
    createdAt: "2026-10-12T09:00:00.000Z", endpointId: "ep-own-case", endpointHost: "ep-own-case.region.aws.neon.tech",
    databaseName: "ci_test", creationRequestId: "own-create-request-1", databaseId: 123,
    databaseCreatedAt: "2026-10-12T09:00:01.000Z", databaseOwner: "neondb_owner", parentBranchId: "br-source-case" };
}
function observe(): Extract<WorkflowAcceptanceBridgeRequest, { operation: "observe" }> {
  return { version: 1, operation: "observe", context: context(), caseDirectory: "D:/owned/case", provenance: provenance(),
    ownedProcessIds: [123, 124], processObservation: { executionDomainId: owner, sourceMatched: true,
      launchOwnershipVerified: true, termination: "natural", exitCode: 0, processObservationComplete: true,
      remainingOwnedProcesses: 0, allRealmReceiptsCollected: false, ownedBranchVerified: false,
      applicationName: context().applicationName, databaseBranchId: context().databaseBranchId,
      databaseObservationComplete: false, databaseSnapshotFresh: false, databaseConnections: null, activeSql: null,
      sdkDirectoryOwnershipVerified: true } };
}
function cleanup(): WorkflowAcceptanceCleanupReceipt {
  return { status: "deleted-and-verified", databaseBranchId: context().databaseBranchId, ownershipVerified: true,
    lifecycleAuthorizationVerified: true, deletionRequestSucceeded: true, absenceVerified: true };
}
function finalize(): Extract<WorkflowAcceptanceBridgeRequest, { operation: "finalize" }> {
  return { version: 1, operation: "finalize", context: context(), caseDirectory: "D:/owned/case",
    provenance: provenance(), cleanup: cleanup() };
}
function observedRecord(): WorkflowAcceptanceObservedRecord {
  const pool = "33333333-3333-4333-8333-333333333333";
  return { version: 1, context: context(), caseDirectory: "D:/owned/case", provenance: provenance(), ownedProcessIds: [123, 124],
    child: { version: 1, context: context(), businessStatus: "passed", failureCode: null, cleanupPermitted: false,
      realms: [{ executionDomainId: owner, realmId: "44444444-4444-4444-8444-444444444444", processId: 124, threadId: 0,
        pools: { ownerId: owner, state: "callbacks_completed", poolIds: [pool], completedIds: [pool], failedIds: [], unknownIds: [], cleanupPermitted: false } }] },
    observation: { ...observe().processObservation, allRealmReceiptsCollected: true, ownedBranchVerified: true,
      databaseObservationComplete: true, databaseSnapshotFresh: true, databaseConnections: 0, activeSql: 0 },
    databaseObservation: { checkedAt: "2026-10-12T10:00:00.000Z", applicationName: context().applicationName,
      databaseBranchId: context().databaseBranchId, databaseConnections: 0, activeSql: 0, observationStatus: "observed" },
    observedAt: "2026-10-12T10:00:01.000Z" };
}

describe("工作流验收分阶段桥接契约", () => {
  it("观察和终结是两个请求，观察文件不提前声明清理或通过", () => {
    expect(WorkflowAcceptanceBridgeRequest.parse(observe())).toEqual(observe());
    expect(WorkflowAcceptanceBridgeRequest.parse(finalize())).toEqual(finalize());
    expect(WorkflowAcceptanceObservedRecord.parse(observedRecord())).toEqual(observedRecord());
    expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...observe(), cleanup: cleanup() }).success).toBe(false);
    expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...finalize(), processObservation: observe().processObservation }).success).toBe(false);
    expect(WorkflowAcceptanceObservedRecord.safeParse({ ...observedRecord(), cleanup: cleanup() }).success).toBe(false);
    expect(WorkflowAcceptanceObservedRecord.safeParse({ ...observedRecord(), evaluation: { outcome: "passed" } }).success).toBe(false);
    expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...observe(), operation: "observe-and-finalize" }).success).toBe(false);
  });
  it.each(["allRealmReceiptsCollected", "ownedBranchVerified", "databaseObservationComplete", "databaseSnapshotFresh"] as const)("观察请求不能自行设置派生真值：%s", (key) => {
    const request = observe(); request.processObservation[key] = true;
    expect(WorkflowAcceptanceBridgeRequest.safeParse(request).success).toBe(false);
  });
  it.each(["databaseConnections", "activeSql"] as const)("观察前未知数量不能声称为零：%s", (key) => {
    const request = observe(); request.processObservation[key] = 0;
    expect(WorkflowAcceptanceBridgeRequest.safeParse(request).success).toBe(false);
  });
  it("进程失败可以如实请求记录，但契约解析不是验收通过", () => {
    const request = observe(); Object.assign(request.processObservation, { termination: "forced", exitCode: 1,
      remainingOwnedProcesses: null, processObservationComplete: false });
    const parsed = WorkflowAcceptanceBridgeRequest.parse(request);
    if (parsed.operation !== "observe") throw new Error("观察请求类型不一致");
    expect(parsed.processObservation.termination).toBe("forced");
  });
  it.each([[], [123, 123], [0], [-1], [1.1], [Infinity], [0x100000000], Array.from({ length: MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES + 1 }, (_, n) => n + 1)]
    .map((ownedProcessIds) => ({ ownedProcessIds })))("进程清单有界且唯一：$ownedProcessIds", ({ ownedProcessIds }) => {
    expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...observe(), ownedProcessIds }).success).toBe(false);
  });
  it.each(["D:/owned/case", "C:\\owned\\case", "/owned/case"])("接受普通本地绝对路径而不虚称物理归属：%s", (caseDirectory) => {
    expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...observe(), caseDirectory }).success).toBe(true);
  });
  it.each(["case", "../case", "D:case", "D:/", "/", "D:/owned/../case", "D:/owned/./case", "D:/owned//case", "\\\\host\\share\\case", "//host/share/case", "file:///case", "D:/owned/case\n", "D:/owned/\0case"])("拒绝不确定案例路径：%s", (caseDirectory) => {
    expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...observe(), caseDirectory }).success).toBe(false);
  });
  it.each(["executionDomainId", "batchId", "databaseBranchId", "sourceCommit", "sourceFingerprint"] as const)("创建摘要必须绑定冻结身份：%s", (key) => {
    const request = observe();
    if (key === "executionDomainId" || key === "batchId") request.provenance[key] = "55555555-5555-4555-8555-555555555555";
    else if (key === "databaseBranchId") request.provenance[key] = "br-other-case";
    else request.provenance[key] = "c".repeat(key === "sourceCommit" ? 40 : 64);
    expect(WorkflowAcceptanceBridgeRequest.safeParse(request).success).toBe(false);
    expect(WorkflowAcceptanceObservedRecord.safeParse({ ...observedRecord(), provenance: request.provenance }).success).toBe(false);
  });
  it("名称或字符串摘要不能代替官方创建事件与实际归属核验", () => {
    expect(WorkflowAcceptanceOwnedBranchProvenance.parse(provenance())).toEqual(provenance());
    for (const branchName of ["production", "mvp-wf-other-domain", `mvp-wf-${owner}\n`]) {
      expect(WorkflowAcceptanceOwnedBranchProvenance.safeParse({ ...provenance(), branchName }).success).toBe(false);
    }
    for (const endpointHost of ["ep-other.region.aws.neon.tech", "ep-own-case-pooler.region.aws.neon.tech",
      "ep-own-case.pgbouncer.neon.tech", "https://ep-own-case.neon.tech", "ep-own-case.neon.tech:5432", "ep-own-case.neon.tech\n"]) {
      expect(WorkflowAcceptanceOwnedBranchProvenance.safeParse({ ...provenance(), endpointHost }).success).toBe(false);
    }
    expect(WorkflowAcceptanceOwnedBranchProvenance.safeParse({ ...provenance(), databaseName: "neondb" }).success).toBe(false);
    expect(WorkflowAcceptanceOwnedBranchProvenance.safeParse({ ...provenance(), creationRequestId: "\n" }).success).toBe(false);
  });
  it("跨域进程、数据库和清理回执不能混入本案例", () => {
    const request = observe(); request.processObservation.databaseBranchId = "br-other-case";
    expect(WorkflowAcceptanceBridgeRequest.safeParse(request).success).toBe(false);
    expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...finalize(), cleanup: { ...cleanup(), databaseBranchId: "br-other-case" } }).success).toBe(false);
    const record = observedRecord(); record.child.realms[0].processId = 999;
    expect(WorkflowAcceptanceObservedRecord.safeParse(record).success).toBe(false);
    record.child.realms[0].processId = 124; record.child.context.sourceCommit = "c".repeat(40);
    expect(WorkflowAcceptanceObservedRecord.safeParse(record).success).toBe(false);
    expect(WorkflowAcceptanceObservedRecord.safeParse({ ...observedRecord(), databaseObservation: {
      ...observedRecord().databaseObservation, databaseBranchId: "br-other-case" } }).success).toBe(false);
  });
  it("观察记录保留真实未知或非零状态，不自行产生清理许可", () => {
    const record = observedRecord();
    Object.assign(record.databaseObservation, { observationStatus: "unknown", databaseConnections: null, activeSql: null });
    Object.assign(record.observation, { databaseObservationComplete: false, databaseSnapshotFresh: false, databaseConnections: null, activeSql: null });
    expect(WorkflowAcceptanceObservedRecord.parse(record).databaseObservation.observationStatus).toBe("unknown");
    record.observation.databaseConnections = 0;
    expect(WorkflowAcceptanceObservedRecord.safeParse(record).success).toBe(false);
    const active = observedRecord(); active.observation.databaseConnections = 1; active.observation.activeSql = 1;
    active.databaseObservation.databaseConnections = 1; active.databaseObservation.activeSql = 1;
    expect(WorkflowAcceptanceObservedRecord.parse(active).observation.activeSql).toBe(1);
    expect(WorkflowAcceptanceObservedRecord.safeParse({ ...active, observedAt: "2026-10-12T09:59:59.000Z" }).success).toBe(false);
  });
  it("拒绝请求中的密钥、连接串、异常正文及未知字段", () => {
    for (const data of [observe(), finalize(), observedRecord(), provenance()]) {
      const schema = "operation" in data ? WorkflowAcceptanceBridgeRequest : "child" in data ? WorkflowAcceptanceObservedRecord : WorkflowAcceptanceOwnedBranchProvenance;
      for (const key of ["apiKey", "databaseUrl", "rawError"]) expect(schema.safeParse({ ...data, [key]: "private-value" }).success).toBe(false);
    }
  });
  it("先拒绝访问器、稀疏或自定义原型数组，不执行序列化钩子", () => {
    let reads = 0;
    const request = observe(); Object.defineProperty(request.provenance, "endpointHost", { enumerable: true, get() { reads += 1; return "ep-own-case.neon.tech"; } });
    expect(WorkflowAcceptanceBridgeRequest.safeParse(request).success).toBe(false);
    const sparse = new Array(1), prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, "0", { get() { reads += 1; return 123; } });
    Object.defineProperty(prototype, "toJSON", { value() { reads += 1; return [123]; } });
    expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...observe(), ownedProcessIds: sparse }).success).toBe(false);
    Object.setPrototypeOf(sparse, prototype);
    expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...observe(), ownedProcessIds: sparse }).success).toBe(false);
    expect(reads).toBe(0);
  });
  it("允许其他原生VM普通数据，拒绝循环与非普通对象", () => {
    expect(WorkflowAcceptanceBridgeRequest.parse(runInNewContext(`(${JSON.stringify(observe())})`))).toEqual(observe());
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const raw of [cyclic, new Date(), { ...observe(), toJSON() { throw new Error("不得执行"); } }]) {
      expect(WorkflowAcceptanceBridgeRequest.safeParse(raw).success).toBe(false);
    }
  });
  it("总UTF8字节在结构解析前有界", () => {
    const raw = { ...observe(), padding: "字".repeat(12_000) };
    expect(raw.padding.length).toBeLessThan(MAX_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_BYTES);
    const parsed = WorkflowAcceptanceBridgeRequest.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toBe("验收桥接只能包含有界普通数据");
  });
});

function preparation(): WorkflowAcceptanceCasePreparationRequest {
  const frozen = context();
  return { version: 1, batchId: frozen.batchId, caseId: frozen.caseId,
    sourceCommit: frozen.sourceCommit, sourceFingerprint: frozen.sourceFingerprint };
}

describe("实际创建隔离资源前的准备契约", () => {
  it.each(WorkflowAcceptanceCaseId.options.map((caseId) => ({ caseId })))("原七案例只携带冻结批次及来源：$caseId", ({ caseId }) => {
    const request = { ...preparation(), caseId };
    expect(WorkflowAcceptanceCasePreparationRequest.parse(request)).toEqual(request);
    expect(Object.keys(request)).toEqual(["version", "batchId", "caseId", "sourceCommit", "sourceFingerprint"]);
  });
  it.each(["databaseBranchId", "executionDomainId", "sdkDirectory", "caseDirectory", "provenance", "cleanup",
    "ownedProcessIds", "processObservation", "databaseUrl", "apiKey"])("准备请求不能指定父方资源或秘密：%s", (field) => {
    expect(WorkflowAcceptanceCasePreparationRequest.safeParse({ ...preparation(), [field]: "not-accepted" }).success).toBe(false);
  });
  it("冻结来源必填且严格校验，不能借占位分支或较短摘要启动", () => {
    const frozen = preparation();
    for (const field of ["batchId", "caseId", "sourceCommit", "sourceFingerprint"] as const) {
      const missing: Record<string, unknown> = { ...frozen }; delete missing[field];
      expect(WorkflowAcceptanceCasePreparationRequest.safeParse(missing).success).toBe(false);
    }
    for (const change of [{ version: 2 }, { batchId: "pending" }, { caseId: "all-passed" },
      { sourceCommit: "a".repeat(39) }, { sourceCommit: "a".repeat(40) + "\n" },
      { sourceFingerprint: "b".repeat(63) }, { sourceFingerprint: "B".repeat(64) }]) {
      expect(WorkflowAcceptanceCasePreparationRequest.safeParse({ ...frozen, ...change }).success).toBe(false);
    }
  });
  it("仅规范化批次UUID，不推断运行域、分支、目录或任何清理许可", () => {
    const batchId = "abcdefab-1234-4123-8123-abcdefabcdef";
    expect(WorkflowAcceptanceCasePreparationRequest.parse({ ...preparation(), batchId: batchId.toUpperCase() }))
      .toEqual({ ...preparation(), batchId });
    expect(WorkflowAcceptanceCasePreparationRequest.parse(runInNewContext(`(${JSON.stringify(preparation())})`))).toEqual(preparation());
  });
  it("普通数据预检先拒绝字段访问器和序列化函数", () => {
    const request = preparation(); let calls = 0;
    Object.defineProperty(request, "sourceCommit", { enumerable: true, get() { calls += 1; return "a".repeat(40); } });
    expect(WorkflowAcceptanceCasePreparationRequest.safeParse(request).success).toBe(false);
    const inherited = Object.create({ toJSON() { calls += 1; return preparation(); } }); Object.assign(inherited, preparation());
    expect(WorkflowAcceptanceCasePreparationRequest.safeParse(inherited).success).toBe(false);
    expect(calls).toBe(0);
  });
  it("UTF8上限在结构解析前拒绝膨胀或循环准备数据", () => {
    const expanded = { ...preparation(), padding: "字".repeat(900) };
    expect(expanded.padding.length).toBeLessThan(MAX_WORKFLOW_ACCEPTANCE_PREPARATION_REQUEST_BYTES);
    const parsed = WorkflowAcceptanceCasePreparationRequest.safeParse(expanded);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toBe("验收桥接只能包含有界普通数据");
    const cyclic: Record<string, unknown> = { ...preparation() }; cyclic.self = cyclic;
    expect(WorkflowAcceptanceCasePreparationRequest.safeParse(cyclic).success).toBe(false);
  });
});

function emptyDatabaseObservation(): WorkflowAcceptanceEmptyDatabaseObservation {
  const owned = provenance();
  return { version: 1, databaseBranchId: owned.databaseBranchId, endpointId: owned.endpointId,
    databaseName: "ci_test", checkedAt: "2026-10-12T10:00:00.000Z", userRelationCount: 0, observationStatus: "observed" };
}

describe("迁移前专用数据库实际观测契约", () => {
  it.each([0, 1, Number.MAX_SAFE_INTEGER])("如实保留已观察数量，不把合法非零值变成空库：%s", (userRelationCount) => {
    const receipt = { ...emptyDatabaseObservation(), userRelationCount };
    expect(WorkflowAcceptanceEmptyDatabaseObservation.parse(receipt)).toEqual(receipt);
  });
  it.each(["failed", "unknown"] as const)("%s 只接受未知数量，不生成零或清理许可", (observationStatus) => {
    const receipt = { ...emptyDatabaseObservation(), observationStatus, userRelationCount: null };
    expect(WorkflowAcceptanceEmptyDatabaseObservation.parse(receipt)).toEqual(receipt);
    for (const userRelationCount of [0, 1]) {
      expect(WorkflowAcceptanceEmptyDatabaseObservation.safeParse({ ...receipt, userRelationCount }).success).toBe(false);
    }
  });
  it.each([null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "0"]
    .map((userRelationCount) => ({ userRelationCount })))("已观察必须有非负安全整数：$userRelationCount", ({ userRelationCount }) => {
    expect(WorkflowAcceptanceEmptyDatabaseObservation.safeParse({ ...emptyDatabaseObservation(), userRelationCount }).success).toBe(false);
  });
  it.each([
    { version: 2 }, { databaseBranchId: "production" }, { databaseBranchId: "br-own-case\n" },
    { endpointId: "ep-own-case\n" }, { endpointId: "https://ep-own-case.neon.tech" }, { databaseName: "neondb" },
    { checkedAt: "unknown" }, { observationStatus: "empty" },
  ])("拒绝不完整或不确定的资源观测：%j", (change) => {
    expect(WorkflowAcceptanceEmptyDatabaseObservation.safeParse({ ...emptyDatabaseObservation(), ...change }).success).toBe(false);
  });
  it.each(["version", "databaseBranchId", "endpointId", "databaseName", "checkedAt", "userRelationCount", "observationStatus"])("实际观测字段不能省略：%s", (field) => {
    const receipt: Record<string, unknown> = { ...emptyDatabaseObservation() }; delete receipt[field];
    expect(WorkflowAcceptanceEmptyDatabaseObservation.safeParse(receipt).success).toBe(false);
  });
  it.each(["apiKey", "databaseUrl", "rawError", "emptyVerified", "cleanupPermitted"])("不接收秘密、错误正文或预先通过声明：%s", (field) => {
    expect(WorkflowAcceptanceEmptyDatabaseObservation.safeParse({ ...emptyDatabaseObservation(), [field]: true }).success).toBe(false);
  });
  it("只验证有界普通数据，不能由访问器或序列化函数提供观察事实", () => {
    let reads = 0;
    const receipt = emptyDatabaseObservation();
    Object.defineProperty(receipt, "userRelationCount", { enumerable: true, get() { reads += 1; return 0; } });
    expect(WorkflowAcceptanceEmptyDatabaseObservation.safeParse(receipt).success).toBe(false);
    const inherited = Object.create({ toJSON() { reads += 1; return emptyDatabaseObservation(); } });
    Object.assign(inherited, emptyDatabaseObservation());
    expect(WorkflowAcceptanceEmptyDatabaseObservation.safeParse(inherited).success).toBe(false);
    expect(reads).toBe(0);
    expect(WorkflowAcceptanceEmptyDatabaseObservation.parse(runInNewContext(`(${JSON.stringify(emptyDatabaseObservation())})`)))
      .toEqual(emptyDatabaseObservation());
  });
  it("超长或循环观测在字段解析前拒绝", () => {
    const expanded = { ...emptyDatabaseObservation(), padding: "字".repeat(900) };
    expect(expanded.padding.length).toBeLessThan(MAX_WORKFLOW_ACCEPTANCE_EMPTY_DATABASE_OBSERVATION_BYTES);
    const parsed = WorkflowAcceptanceEmptyDatabaseObservation.safeParse(expanded);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toBe("验收桥接只能包含有界普通数据");
    const cyclic: Record<string, unknown> = { ...emptyDatabaseObservation() }; cyclic.self = cyclic;
    expect(WorkflowAcceptanceEmptyDatabaseObservation.safeParse(cyclic).success).toBe(false);
  });
});

function observeEmpty(): Extract<WorkflowAcceptanceBridgeRequest, { operation: "observe-empty" }> {
  return { version: 1, operation: "observe-empty", context: context(), caseDirectory: "D:/owned/case", provenance: provenance() };
}

describe("迁移前空库观察请求与结果分离", () => {
  it.each(WorkflowAcceptanceCaseId.options.map((caseId) => ({ caseId })))("原案例只请求本冻结目标的观察：$caseId", ({ caseId }) => {
    const request = { ...observeEmpty(), context: { ...context(), caseId } };
    const parsed = WorkflowAcceptanceBridgeRequest.parse(request);
    expect(parsed).toEqual(request);
    expect(Object.keys(parsed)).toEqual(["version", "context", "caseDirectory", "provenance", "operation"]);
  });
  it.each(["executionDomainId", "batchId", "databaseBranchId", "sourceCommit", "sourceFingerprint"] as const)("空库请求不能混入其他冻结身份：%s", (key) => {
    const request = observeEmpty();
    if (key === "executionDomainId" || key === "batchId") request.provenance[key] = "55555555-5555-4555-8555-555555555555";
    else if (key === "databaseBranchId") request.provenance[key] = "br-other-case";
    else request.provenance[key] = "c".repeat(key === "sourceCommit" ? 40 : 64);
    expect(WorkflowAcceptanceBridgeRequest.safeParse(request).success).toBe(false);
  });
  it.each(["emptyObservation", "userRelationCount", "observationStatus", "checkedAt", "emptyVerified", "cleanup",
    "ownedProcessIds", "processObservation", "databaseUrl", "apiKey", "rawError"])("请求不能提供观察结果、清理声明或秘密：%s", (field) => {
    expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...observeEmpty(), [field]: true }).success).toBe(false);
  });
  it.each(["context", "provenance", "caseDirectory"])("父方目标字段不能省略：%s", (field) => {
    const request: Record<string, unknown> = { ...observeEmpty() }; delete request[field];
    expect(WorkflowAcceptanceBridgeRequest.safeParse(request).success).toBe(false);
  });
  it("复用原本地路径限制，不由请求声明物理目录或官方归属", () => {
    for (const caseDirectory of ["D:/owned/case", "C:/owned/case", "/owned/case"]) {
      expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...observeEmpty(), caseDirectory }).success).toBe(true);
    }
    for (const caseDirectory of ["relative/case", "D:/owned/../case", "//host/share/case"]) {
      expect(WorkflowAcceptanceBridgeRequest.safeParse({ ...observeEmpty(), caseDirectory }).success).toBe(false);
    }
  });
  it("访问器及继承序列化函数不能执行，普通跨VM数据保留", () => {
    let calls = 0;
    const request = observeEmpty();
    Object.defineProperty(request.provenance, "endpointHost", { enumerable: true, get() { calls += 1; return "ep-own-case.neon.tech"; } });
    expect(WorkflowAcceptanceBridgeRequest.safeParse(request).success).toBe(false);
    const inherited = Object.create({ toJSON() { calls += 1; return observeEmpty(); } });
    Object.assign(inherited, observeEmpty());
    expect(WorkflowAcceptanceBridgeRequest.safeParse(inherited).success).toBe(false);
    expect(calls).toBe(0);
    expect(WorkflowAcceptanceBridgeRequest.parse(runInNewContext("(" + JSON.stringify(observeEmpty()) + ")"))).toEqual(observeEmpty());
  });
  it("在字段解析前保留总UTF8上限及循环数据拒绝", () => {
    const expanded = { ...observeEmpty(), padding: "字".repeat(12_000) };
    expect(expanded.padding.length).toBeLessThan(MAX_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_BYTES);
    const parsed = WorkflowAcceptanceBridgeRequest.safeParse(expanded);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toBe("验收桥接只能包含有界普通数据");
    const cyclic: Record<string, unknown> = { ...observeEmpty() }; cyclic.self = cyclic;
    expect(WorkflowAcceptanceBridgeRequest.safeParse(cyclic).success).toBe(false);
  });
});

describe("本次数据库创建身份摘要", () => {
  it.each([Number.MIN_SAFE_INTEGER, -1, 0, 1, Number.MAX_SAFE_INTEGER])("如实保留可无损表示的官方整数ID：%s", (databaseId) => {
    const record = { ...provenance(), databaseId };
    expect(WorkflowAcceptanceOwnedBranchProvenance.parse(record)).toEqual(record);
  });
  it.each([null, "123", NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, {}]
    .map((databaseId) => ({ databaseId })))("拒绝失精度、字符串替代和非整数ID：$databaseId", ({ databaseId }) => {
    expect(WorkflowAcceptanceOwnedBranchProvenance.safeParse({ ...provenance(), databaseId }).success).toBe(false);
  });
  it.each(["databaseId", "databaseCreatedAt", "databaseOwner", "parentBranchId"])("创建摘要必须包含父方实际创建字段：%s", (field) => {
    const record: Record<string, unknown> = { ...provenance() }; delete record[field];
    expect(WorkflowAcceptanceOwnedBranchProvenance.safeParse(record).success).toBe(false);
  });
  it("拒绝不确定的创建时间、非专用角色或无效来源，不生成归属证明", () => {
    for (const change of [{ databaseCreatedAt: "unknown" }, { databaseOwner: "other_owner" },
      { parentBranchId: "production" }, { parentBranchId: provenance().databaseBranchId }]) {
      expect(WorkflowAcceptanceOwnedBranchProvenance.safeParse({ ...provenance(), ...change }).success).toBe(false);
    }
    expect(WorkflowAcceptanceOwnedBranchProvenance.safeParse({ ...provenance(), databaseCreationVerified: true }).success).toBe(false);
  });
  it("不能通过访问器伪造创建ID，也不执行输入对象的序列化函数", () => {
    let reads = 0;
    const record = provenance();
    Object.defineProperty(record, "databaseId", { enumerable: true, get() { reads += 1; return 123; } });
    expect(WorkflowAcceptanceOwnedBranchProvenance.safeParse(record).success).toBe(false);
    const inherited = Object.create({ toJSON() { reads += 1; return provenance(); } });
    Object.assign(inherited, provenance());
    expect(WorkflowAcceptanceOwnedBranchProvenance.safeParse(inherited).success).toBe(false);
    expect(reads).toBe(0);
  });
});
