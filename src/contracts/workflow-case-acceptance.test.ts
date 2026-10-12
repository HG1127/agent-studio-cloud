import { describe, expect, it } from "vitest";
import {
  MAX_WORKFLOW_ACCEPTANCE_REALMS, MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES,
  WorkflowAcceptanceCaseId, WorkflowAcceptanceContext, WorkflowAcceptanceChildReport,
  WorkflowAcceptanceParentObservation, WorkflowAcceptanceEvidenceEvaluation,
  WorkflowAcceptanceCleanupReceipt, WorkflowAcceptanceCaseResult, WorkflowAcceptanceBatchResult,
  WorkflowAcceptanceDatabaseObservation,
  WorkflowAcceptanceRealmRegistration, WorkflowAcceptanceRealmFinalReceipt,
} from "./workflow-case-acceptance";

const owner = "11111111-1111-4111-8111-111111111111";
const pool = "22222222-2222-4222-8222-222222222222";
function context(): WorkflowAcceptanceContext {
  return { version: 1, batchId: "33333333-3333-4333-8333-333333333333", caseId: "harness-retry",
    sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), executionDomainId: owner,
    databaseBranchId: "br-isolated-case", applicationName: `mvp_wf_${owner.replaceAll("-", "")}`,
    sdkDirectory: "D:/owned/cases/harness-retry/sdk" };
}
function child(): WorkflowAcceptanceChildReport {
  return { version: 1, context: context(), businessStatus: "passed", failureCode: null, cleanupPermitted: false,
    realms: [{ executionDomainId: owner, realmId: "44444444-4444-4444-8444-444444444444", processId: 123, threadId: 1,
      pools: { ownerId: owner, state: "callbacks_completed", poolIds: [pool], completedIds: [pool],
        failedIds: [], unknownIds: [], cleanupPermitted: false } }] };
}
function observation(): WorkflowAcceptanceParentObservation {
  return { executionDomainId: owner, sourceMatched: true, launchOwnershipVerified: true, termination: "natural", exitCode: 0,
    processObservationComplete: true, remainingOwnedProcesses: 0, allRealmReceiptsCollected: true, ownedBranchVerified: true,
    applicationName: context().applicationName, databaseBranchId: context().databaseBranchId,
    databaseObservationComplete: true, databaseSnapshotFresh: true, databaseConnections: 0, activeSql: 0, sdkDirectoryOwnershipVerified: true };
}
function caseResult(): WorkflowAcceptanceCaseResult {
  return { version: 1, context: context(), child: child(), observation: observation(),
    evaluation: { outcome: "passed", cleanupPermitted: true, failures: [] },
    cleanup: { status: "not-attempted", databaseBranchId: context().databaseBranchId, ownershipVerified: false,
      lifecycleAuthorizationVerified: false, deletionRequestSucceeded: false, absenceVerified: false } };
}
function batchResult(): WorkflowAcceptanceBatchResult {
  const cases = WorkflowAcceptanceCaseId.options.map((caseId, index) => {
    const result = caseResult(), executionDomainId = `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`;
    Object.assign(result.context, { caseId, executionDomainId, applicationName: `mvp_wf_${executionDomainId.replaceAll("-", "")}`,
      databaseBranchId: `br-owned-case-${index}`, sdkDirectory: `D:/owned/cases/${caseId}/sdk` });
    result.child.context = { ...result.context };
    result.child.realms[0].executionDomainId = executionDomainId; result.child.realms[0].pools.ownerId = executionDomainId;
    Object.assign(result.observation, { executionDomainId, applicationName: result.context.applicationName, databaseBranchId: result.context.databaseBranchId });
    result.cleanup.databaseBranchId = result.context.databaseBranchId;
    return result;
  });
  return { version: 1, batchId: context().batchId, sourceCommit: context().sourceCommit, sourceFingerprint: context().sourceFingerprint, cases };
}

describe("工作流执行域验收共享契约", () => {
  it("逐项保留原七个业务验收标识", () => {
    expect(WorkflowAcceptanceCaseId.options).toEqual([
      "public-tool-approval-idempotency", "harness-frozen-denial", "harness-child-inherits", "harness-legacy-snapshot",
      "harness-invalid-parent", "harness-administrator-and-invalid-snapshot", "harness-retry",
    ]);
    expect(WorkflowAcceptanceCaseId.safeParse("all-passed").success).toBe(false);
  });
  it("执行域标记稳定，子回执不能自行取得清理许可", () => {
    expect(WorkflowAcceptanceContext.parse(context())).toEqual(context());
    expect(WorkflowAcceptanceChildReport.parse(child())).toEqual(child());
    expect(WorkflowAcceptanceParentObservation.parse(observation())).toEqual(observation());
    expect(WorkflowAcceptanceChildReport.safeParse({ ...child(), cleanupPermitted: true }).success).toBe(false);
    const report = child();
    expect(WorkflowAcceptanceChildReport.safeParse({ ...report, realms: [{ ...report.realms[0],
      pools: { ...report.realms[0].pools, cleanupPermitted: true } }] }).success).toBe(false);
  });
  it("拒绝其他执行域的数据库观测标记", () => {
    expect(WorkflowAcceptanceContext.safeParse({ ...context(), applicationName: "mvp_wf_" + "9".repeat(32) }).success).toBe(false);
  });
  it.each(["D:/owned/sdk", "C:\\owned\\case\\sdk", "/owned/cases/sdk"])("目录只作本地路径校验，不证明归属：%s", (sdkDirectory) => {
    expect(WorkflowAcceptanceContext.safeParse({ ...context(), sdkDirectory }).success).toBe(true);
  });
  it.each(["sdk", "../sdk", "D:relative", "D:/", "/", "D:/owned/../sdk", "D:/owned/./sdk", "D:/owned//sdk",
    "\\\\host\\share\\sdk", "//host/share/sdk", "file:///owned/sdk", "https://example.test/sdk", "D:/owned/sdk\n", "D:/owned/\0sdk"])("拒绝不确定本地执行目录：%s", (sdkDirectory) => {
    expect(WorkflowAcceptanceContext.safeParse({ ...context(), sdkDirectory }).success).toBe(false);
  });
  it("混入其他执行域、重复空间或重复连接池不能当作完整回执", () => {
    const foreign = child(); foreign.realms[0].executionDomainId = "55555555-5555-4555-8555-555555555555";
    expect(WorkflowAcceptanceChildReport.safeParse(foreign).success).toBe(false);
    const duplicate = child(); duplicate.realms.push(structuredClone(duplicate.realms[0]));
    expect(WorkflowAcceptanceChildReport.safeParse(duplicate).success).toBe(false);
    duplicate.realms[1].realmId = "66666666-6666-4666-8666-666666666666";
    duplicate.realms[1].threadId = 2;
    expect(WorkflowAcceptanceChildReport.safeParse(duplicate).success).toBe(false);
  });
  it("空间数量有界，不能靠重复清单填满报告", () => {
    const report = child(); report.realms = Array.from({ length: MAX_WORKFLOW_ACCEPTANCE_REALMS + 1 }, () => structuredClone(report.realms[0]));
    expect(WorkflowAcceptanceChildReport.safeParse(report).success).toBe(false);
  });
  it("同一进程线程中的独立VM空间不被合并，登记与池身份仍须唯一", () => {
    const report = child(), second = structuredClone(report.realms[0]);
    const secondPool = "77777777-7777-4777-8777-777777777777";
    second.realmId = "66666666-6666-4666-8666-666666666666";
    second.pools.poolIds = [secondPool]; second.pools.completedIds = [secondPool];
    report.realms.push(second);
    expect(WorkflowAcceptanceChildReport.parse(report).realms).toHaveLength(2);
    second.realmId = report.realms[0].realmId;
    expect(WorkflowAcceptanceChildReport.safeParse(report).success).toBe(false);
  });
  it.each(["business", "pool-close", "setup", "unknown"] as const)("未通过必须携带安全失败码：%s", (failureCode) => {
    expect(WorkflowAcceptanceChildReport.safeParse({ ...child(), businessStatus: "failed", failureCode }).success).toBe(true);
    expect(WorkflowAcceptanceChildReport.safeParse({ ...child(), failureCode }).success).toBe(false);
    expect(WorkflowAcceptanceChildReport.safeParse({ ...child(), businessStatus: "unknown" }).success).toBe(false);
  });
  it("连接未关闭、回调失败及未知状态可报告，但不能伪装全部关闭", () => {
    for (const state of ["open", "closing", "callback_failed"] as const) {
      const report = child(); report.realms[0].pools = { ownerId: owner, state, poolIds: [pool], completedIds: [], failedIds: [], unknownIds: [pool], cleanupPermitted: false };
      expect(WorkflowAcceptanceChildReport.safeParse(report).success).toBe(true);
      report.realms[0].pools.state = "callbacks_completed";
      expect(WorkflowAcceptanceChildReport.safeParse(report).success).toBe(false);
    }
  });
  it("严格拒绝连接串、异常正文与未知附加字段", () => {
    const secret = "postgres://private-user:private-password@private-host/private-db";
    for (const schema of [WorkflowAcceptanceContext, WorkflowAcceptanceChildReport, WorkflowAcceptanceParentObservation]) {
      const data = schema === WorkflowAcceptanceContext ? context() : schema === WorkflowAcceptanceChildReport ? child() : observation();
      expect(schema.safeParse({ ...data, databaseUrl: secret }).success).toBe(false);
    }
    expect(WorkflowAcceptanceChildReport.safeParse({ ...child(), failureCode: secret }).success).toBe(false);
  });
  it("先判定普通数据，任何输入层的访问器都不执行", () => {
    let reads = 0;
    const rawContext = { ...context() };
    Object.defineProperty(rawContext, "sdkDirectory", { enumerable: true, get() { reads += 1; return context().sdkDirectory; } });
    const rawObservation = { ...observation() };
    Object.defineProperty(rawObservation, "databaseConnections", { enumerable: true, get() { reads += 1; return 0; } });
    expect(WorkflowAcceptanceContext.safeParse(rawContext).success).toBe(false);
    expect(WorkflowAcceptanceChildReport.safeParse({ ...child(), context: rawContext }).success).toBe(false);
    expect(WorkflowAcceptanceParentObservation.safeParse(rawObservation).success).toBe(false);
    expect(reads).toBe(0);
  });
  it("UTF8总字节超过上限时在结构解析前拒绝", () => {
    const raw = { ...child(), padding: "字".repeat(200_000) };
    expect(raw.padding.length).toBeLessThan(MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES);
    const parsed = WorkflowAcceptanceChildReport.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toBe("验收报告只能包含有界普通数据");
  });
  it("字节计算不执行数组继承的序列化函数，也不遍历超大稀疏数组", () => {
    const report = child(); let calls = 0;
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, "toJSON", { value() { calls += 1; throw new Error("不得执行"); } });
    Object.setPrototypeOf(report.realms, prototype);
    expect(WorkflowAcceptanceChildReport.safeParse(report).success).toBe(false);
    expect(calls).toBe(0);
    expect(WorkflowAcceptanceChildReport.safeParse({ ...child(), realms: new Array(1_000_000_000) }).success).toBe(false);
  });
  it("普通原型下的空洞与自定义原型继承索引访问器都在schema前拒绝", () => {
    const report = child(), sparse = new Array(1); let reads = 0;
    expect(WorkflowAcceptanceChildReport.safeParse({ ...report, realms: sparse }).success).toBe(false);
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, "0", { get() { reads += 1; return report.realms[0]; } });
    Object.setPrototypeOf(sparse, prototype);
    expect(WorkflowAcceptanceChildReport.safeParse({ ...report, realms: sparse }).success).toBe(false);
    expect(reads).toBe(0);
  });
  it("拒绝循环、非普通对象、序列化函数及非有限数字", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const raw of [cyclic, new Date(), { ...child(), toJSON() { throw new Error("不得执行"); } }, { ...observation(), activeSql: Infinity }]) {
      expect(WorkflowAcceptanceChildReport.safeParse(raw).success).toBe(false);
      expect(WorkflowAcceptanceParentObservation.safeParse(raw).success).toBe(false);
    }
  });
  it("失败判定不允许清理、重复原因或无原因，成功必须有清理许可", () => {
    expect(WorkflowAcceptanceEvidenceEvaluation.parse({ outcome: "passed", cleanupPermitted: true, failures: [] })).toEqual({ outcome: "passed", cleanupPermitted: true, failures: [] });
    for (const raw of [{ outcome: "passed", cleanupPermitted: false, failures: [] }, { outcome: "failed", cleanupPermitted: true, failures: ["business-unconfirmed"] },
      { outcome: "failed", cleanupPermitted: false, failures: [] }, { outcome: "failed", cleanupPermitted: false, failures: ["business-unconfirmed", "business-unconfirmed"] }]) {
      expect(WorkflowAcceptanceEvidenceEvaluation.safeParse(raw).success).toBe(false);
    }
  });
  it("删除回执缺少任一归属、授权、请求成功或缺席确认都不能声明完成", () => {
    const complete = { status: "deleted-and-verified" as const, databaseBranchId: context().databaseBranchId,
      ownershipVerified: true, lifecycleAuthorizationVerified: true, deletionRequestSucceeded: true, absenceVerified: true };
    expect(WorkflowAcceptanceCleanupReceipt.parse(complete)).toEqual(complete);
    for (const key of ["ownershipVerified", "lifecycleAuthorizationVerified", "deletionRequestSucceeded", "absenceVerified"] as const) {
      expect(WorkflowAcceptanceCleanupReceipt.safeParse({ ...complete, [key]: false }).success).toBe(false);
    }
    expect(WorkflowAcceptanceCleanupReceipt.safeParse({ ...complete, status: "not-attempted" }).success).toBe(false);
  });
  it("单案例清理回执不能指向其他分支，结构合格不等于已执行或清理成功", () => {
    const result = caseResult();
    expect(WorkflowAcceptanceCaseResult.parse(result).cleanup.status).toBe("not-attempted");
    result.cleanup.databaseBranchId = "br-unowned-other";
    expect(WorkflowAcceptanceCaseResult.safeParse(result).success).toBe(false);
  });
  it("七项批次必须完整且唯一，不能遗漏或重复某项凑足数量", () => {
    const complete = batchResult();
    expect(WorkflowAcceptanceBatchResult.parse(complete)).toEqual(complete);
    expect(WorkflowAcceptanceBatchResult.safeParse({ ...complete, cases: complete.cases.slice(1) }).success).toBe(false);
    const duplicated = batchResult(); duplicated.cases[1] = structuredClone(duplicated.cases[0]);
    expect(WorkflowAcceptanceBatchResult.safeParse(duplicated).success).toBe(false);
  });
  it("同一批不能混入旧源码或复用执行域、临时分支和引擎目录", () => {
    for (const key of ["batchId", "sourceCommit", "sourceFingerprint"] as const) {
      const result = batchResult();
      Object.assign(result.cases[0].context, { [key]: key === "batchId" ? "55555555-5555-4555-8555-555555555555" : "c".repeat(key === "sourceCommit" ? 40 : 64) });
      expect(WorkflowAcceptanceBatchResult.safeParse(result).success).toBe(false);
    }
    for (const key of ["executionDomainId", "databaseBranchId", "sdkDirectory"] as const) {
      const result = batchResult(); Object.assign(result.cases[1].context, { [key]: result.cases[0].context[key] });
      if (key === "executionDomainId") result.cases[1].context.applicationName = result.cases[0].context.applicationName;
      expect(WorkflowAcceptanceBatchResult.safeParse(result).success).toBe(false);
    }
  });
  it("失败案例仍须留在完整批次中，不能只汇报成功案例", () => {
    const result = batchResult(); result.cases[0].child.businessStatus = "failed"; result.cases[0].child.failureCode = "business";
    result.cases[0].evaluation = { outcome: "failed", cleanupPermitted: false, failures: ["business-unconfirmed"] };
    expect(WorkflowAcceptanceBatchResult.parse(result).cases).toHaveLength(7);
  });
  it("数据库观察不把失败或未知数量变成零，活动SQL不超过同范围连接", () => {
    const observed = { checkedAt: "2026-10-12T10:00:00.000Z", applicationName: context().applicationName,
      databaseBranchId: context().databaseBranchId, databaseConnections: 0, activeSql: 0, observationStatus: "observed" };
    expect(WorkflowAcceptanceDatabaseObservation.parse(observed)).toEqual(observed);
    for (const raw of [{ ...observed, databaseConnections: null }, { ...observed, activeSql: 1 },
      { ...observed, observationStatus: "unknown" }, { ...observed, observationStatus: "failed" }]) {
      expect(WorkflowAcceptanceDatabaseObservation.safeParse(raw).success).toBe(false);
    }
    expect(WorkflowAcceptanceDatabaseObservation.safeParse({ ...observed, observationStatus: "unknown", databaseConnections: null, activeSql: null }).success).toBe(true);
  });
  it("登记和最终回执共用冻结上下文，禁止额外密钥或跨域最终回执", () => {
    const receipt = child().realms[0];
    const registered = { version: 1, context: context(), realmId: receipt.realmId, processId: receipt.processId, threadId: receipt.threadId };
    expect(WorkflowAcceptanceRealmRegistration.parse(registered)).toEqual(registered);
    expect(WorkflowAcceptanceRealmRegistration.safeParse({ ...registered, uri: "private-uri" }).success).toBe(false);
    const final = { version: 1, context: context(), receipt };
    expect(WorkflowAcceptanceRealmFinalReceipt.parse(final)).toEqual(final);
    expect(WorkflowAcceptanceRealmFinalReceipt.safeParse({ ...final, context: { ...context(),
      executionDomainId: "55555555-5555-4555-8555-555555555555", applicationName: "mvp_wf_55555555555545558555555555555555" } }).success).toBe(false);
  });
});
