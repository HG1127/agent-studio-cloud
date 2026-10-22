import { describe, expect, it } from "vitest";
import type { WorkflowAcceptanceContext, WorkflowAcceptanceChildReport, WorkflowAcceptanceParentObservation } from "@/contracts/workflow-case-acceptance";
import { evaluateWorkflowAcceptanceEvidence } from "./workflow-acceptance-evidence";

const owner = "11111111-1111-4111-8111-111111111111";
const pool = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const context: WorkflowAcceptanceContext = { version: 1, batchId: "33333333-3333-4333-8333-333333333333", caseId: "harness-retry",
    sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), executionDomainId: owner, databaseBranchId: "br-isolated-case",
    applicationName: `mvp_wf_${owner.replaceAll("-", "")}`, sdkDirectory: "D:/owned/cases/harness-retry/sdk" };
  const child: WorkflowAcceptanceChildReport = { version: 1, context: { ...context }, businessStatus: "passed", failureCode: null, cleanupPermitted: false,
    realms: [{ executionDomainId: owner, realmId: "44444444-4444-4444-8444-444444444444", processId: 123, threadId: 1,
      pools: { ownerId: owner, state: "callbacks_completed", poolIds: [pool], completedIds: [pool], failedIds: [], unknownIds: [], cleanupPermitted: false } }] };
  const observation: WorkflowAcceptanceParentObservation = { executionDomainId: owner, sourceMatched: true, launchOwnershipVerified: true,
    termination: "natural", exitCode: 0, processObservationComplete: true, remainingOwnedProcesses: 0, allRealmReceiptsCollected: true,
    ownedBranchVerified: true, applicationName: context.applicationName, databaseBranchId: context.databaseBranchId,
    databaseObservationComplete: true, databaseSnapshotFresh: true, databaseConnections: 0, activeSql: 0, sdkDirectoryOwnershipVerified: true };
  return { context, child, observation };
}
function evaluate(value = fixture()) { return evaluateWorkflowAcceptanceEvidence(value.context, value.child, value.observation); }
const uncertainObservations: Array<{ title: string; change: Partial<WorkflowAcceptanceParentObservation>; reason: string }> = [
  { title: "来源不相同", change: { sourceMatched: false }, reason: "source-unconfirmed" },
  { title: "启动归属未知", change: { launchOwnershipVerified: false }, reason: "process-exit-unconfirmed" },
  { title: "强制退出", change: { termination: "forced" }, reason: "process-exit-unconfirmed" },
  { title: "退出方式未知", change: { termination: "unknown" }, reason: "process-exit-unconfirmed" },
  { title: "退出失败", change: { exitCode: 1 }, reason: "process-exit-unconfirmed" },
  { title: "退出码未知", change: { exitCode: null }, reason: "process-exit-unconfirmed" },
  { title: "进程观察不完整", change: { processObservationComplete: false }, reason: "process-exit-unconfirmed" },
  { title: "仍有子进程", change: { remainingOwnedProcesses: 1 }, reason: "process-exit-unconfirmed" },
  { title: "子进程数量未知", change: { remainingOwnedProcesses: null }, reason: "process-exit-unconfirmed" },
  { title: "执行空间回执不完整", change: { allRealmReceiptsCollected: false }, reason: "pool-close-unconfirmed" },
  { title: "数据库分支归属未知", change: { ownedBranchVerified: false }, reason: "database-stop-unconfirmed" },
  { title: "数据库观察分支不相同", change: { databaseBranchId: "br-other-case" }, reason: "database-stop-unconfirmed" },
  { title: "数据库标记不相同", change: { applicationName: "mvp_wf_other" }, reason: "database-stop-unconfirmed" },
  { title: "数据库观察不完整", change: { databaseObservationComplete: false }, reason: "database-stop-unconfirmed" },
  { title: "缓存数据库快照", change: { databaseSnapshotFresh: false }, reason: "database-stop-unconfirmed" },
  { title: "仍有数据库连接", change: { databaseConnections: 1 }, reason: "database-stop-unconfirmed" },
  { title: "数据库连接未知", change: { databaseConnections: null }, reason: "database-stop-unconfirmed" },
  { title: "仍有SQL", change: { activeSql: 1 }, reason: "database-stop-unconfirmed" },
  { title: "SQL数量未知", change: { activeSql: null }, reason: "database-stop-unconfirmed" },
  { title: "执行引擎目录归属未知", change: { sdkDirectoryOwnershipVerified: false }, reason: "sdk-directory-unowned" },
];

describe("工作流验收证据纯判定", () => {
  it("仅消费可信父观察，所有条件成立才允许父方后续清理", () => {
    const value = fixture(), before = structuredClone(value);
    expect(evaluate(value)).toEqual({ outcome: "passed", cleanupPermitted: true, failures: [] });
    expect(value).toEqual(before);
    expect(value.child.cleanupPermitted).toBe(false);
    expect(value.child.realms[0].pools.cleanupPermitted).toBe(false);
  });
  it.each(uncertainObservations)("$title时不允许清理，也不冒充通过", ({ change, reason }) => {
    const value = fixture(); Object.assign(value.observation, change);
    expect(evaluate(value)).toEqual({ outcome: "failed", cleanupPermitted: false, failures: [reason] });
  });
  it("连接回调完成本身不能取代父观察或证明所有生产者退出", () => {
    const value = fixture();
    expect(evaluateWorkflowAcceptanceEvidence(value.context, value.child, undefined)).toEqual({ outcome: "failed", cleanupPermitted: false, failures: ["invalid-parent-observation"] });
    Object.assign(value.observation, { termination: "unknown", exitCode: null, remainingOwnedProcesses: null,
      databaseSnapshotFresh: false, databaseConnections: null, activeSql: null });
    expect(evaluate(value)).toEqual({ outcome: "failed", cleanupPermitted: false, failures: ["process-exit-unconfirmed", "database-stop-unconfirmed"] });
  });
  it.each(["batchId", "caseId", "sourceCommit", "sourceFingerprint", "sdkDirectory", "databaseBranchId"] as const)("子报告的%s必须与父冻结上下文相同", (key) => {
    const value = fixture();
    const replacement = { batchId: "55555555-5555-4555-8555-555555555555", caseId: "harness-frozen-denial" as const,
      sourceCommit: "c".repeat(40), sourceFingerprint: "d".repeat(64), sdkDirectory: "D:/owned/other/sdk", databaseBranchId: "br-other-case" };
    Object.assign(value.child.context, { [key]: replacement[key] });
    expect(evaluate(value)).toEqual({ outcome: "failed", cleanupPermitted: false, failures: ["context-mismatch"] });
  });
  it("父观测执行域不相同也不能复用已有零连接结果", () => {
    const value = fixture(); value.observation.executionDomainId = "55555555-5555-4555-8555-555555555555";
    expect(evaluate(value).failures).toEqual(["context-mismatch"]);
  });
  it.each(["failed", "unknown"] as const)("业务%s，即使退出和数据库均确认也保持失败", (businessStatus) => {
    const value = fixture(); value.child.businessStatus = businessStatus; value.child.failureCode = "business";
    expect(evaluate(value)).toEqual({ outcome: "failed", cleanupPermitted: false, failures: ["business-unconfirmed"] });
  });
  it("未登记任何池或没有空间回执不能取代真实数据库接线", () => {
    const value = fixture(); value.child.realms = [];
    expect(evaluate(value).failures).toEqual(["pool-close-unconfirmed"]);
    const empty = fixture(); Object.assign(empty.child.realms[0].pools, { poolIds: [], completedIds: [] });
    expect(evaluate(empty).failures).toEqual(["pool-close-unconfirmed"]);
  });
  it.each(["closing", "callback_failed"] as const)("池状态%s不能把自然进程退出冒充原生关闭通过", (state) => {
    const value = fixture(); Object.assign(value.child.realms[0].pools, { state, completedIds: [], unknownIds: [pool] });
    expect(evaluate(value).failures).toEqual(["pool-close-unconfirmed"]);
  });
  it("相互独立的失败条件全部保留且不重复", () => {
    const value = fixture(); Object.assign(value.observation, { sourceMatched: false, termination: "forced", databaseConnections: 3, activeSql: 2, sdkDirectoryOwnershipVerified: false });
    value.child.businessStatus = "unknown"; value.child.failureCode = "unknown";
    value.child.realms[0].pools.state = "closing"; value.child.realms[0].pools.completedIds = []; value.child.realms[0].pools.unknownIds = [pool];
    expect(evaluate(value)).toEqual({ outcome: "failed", cleanupPermitted: false,
      failures: ["business-unconfirmed", "pool-close-unconfirmed", "source-unconfirmed", "process-exit-unconfirmed", "database-stop-unconfirmed", "sdk-directory-unowned"] });
  });
  it("无效结构失败关闭，不泄露原始错误或连接串", () => {
    const secret = "postgres://private-user:private-password@private-host/private-db";
    const result = evaluateWorkflowAcceptanceEvidence({ secret }, { secret }, { secret });
    expect(result).toEqual({ outcome: "failed", cleanupPermitted: false, failures: ["invalid-context", "invalid-child-report", "invalid-parent-observation"] });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("纯函数不执行恶意输入的字段访问器", () => {
    const value = fixture(); let reads = 0;
    Object.defineProperty(value.context, "sdkDirectory", { enumerable: true, get() { reads += 1; throw new Error("不应读取"); } });
    expect(evaluate(value)).toEqual({ outcome: "failed", cleanupPermitted: false, failures: ["invalid-context"] });
    expect(reads).toBe(0);
  });
});
