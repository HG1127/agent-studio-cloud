import { describe, expect, it } from "vitest";
import { WorkflowAcceptanceLifecycleObservationEvaluation, WorkflowAcceptanceLifecycleObservationRequest } from "./workflow-process-lifecycle-observation";

const id = (value: number) => "00000000-0000-4000-8000-" + String(value).padStart(12, "0");
function request(): WorkflowAcceptanceLifecycleObservationRequest {
  return { version: 1, operation: "observe-process-lifecycle", context: { version: 1, batchId: id(1), caseId: "harness-retry",
    sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), executionDomainId: id(9), databaseBranchId: "br-test-only",
    applicationName: "mvp_wf_" + id(9).replaceAll("-", ""), sdkDirectory: "D:/test-only/sdk" },
  phase: "business", expectedLifecycleFingerprint: "c".repeat(64),
  expectedRuntimeFingerprints: { adapterFingerprint: "d".repeat(64), sdkFactoryFingerprint: "e".repeat(64) },
  processInventoryRef: { sha256: "f".repeat(64) }, lifecycleRefs: [{ lifecycleId: id(2), sha256: "1".repeat(64) }],
  runtimeRefs: [{ launchId: id(3), sha256: "2".repeat(64) }] };
}
describe("独立生命周期校验契约", () => {
  it("业务来源与原文件必须明确", () => { expect(WorkflowAcceptanceLifecycleObservationRequest.safeParse(request()).success).toBe(true); });
  it.each(["bridge", "migration"] as const)("%s角色不能冒用SDK事实", (phase) => {
    const value = request(); value.phase = phase;
    expect(WorkflowAcceptanceLifecycleObservationRequest.safeParse(value).success).toBe(false);
    value.expectedRuntimeFingerprints = null; value.runtimeRefs = [];
    expect(WorkflowAcceptanceLifecycleObservationRequest.safeParse(value).success).toBe(true);
  });
  it.each(["lifecycleRefs", "runtimeRefs"] as const)("%s拒绝重复引用", (key) => {
    const value = request();
    if (key === "lifecycleRefs") value.lifecycleRefs.push(value.lifecycleRefs[0]);
    else value.runtimeRefs.push(value.runtimeRefs[0]);
    expect(WorkflowAcceptanceLifecycleObservationRequest.safeParse(value).success).toBe(false);
  });
  it("未知结果保留空值而非零，也不授权清理", () => {
    const value = { version: 1, status: "unconfirmed", cleanupPermitted: false, failures: ["invalid-lifecycle"],
      counts: { processes: null, lifecycles: null, subjects: null, executions: null } };
    expect(WorkflowAcceptanceLifecycleObservationEvaluation.safeParse(value).success).toBe(true);
    expect(WorkflowAcceptanceLifecycleObservationEvaluation.safeParse({ ...value, counts: { ...value.counts, subjects: 0 } }).success).toBe(false);
  });
  it("全量集合一致不自报自然或允许清理", () => {
    const value = { version: 1, status: "consistent", cleanupPermitted: false, failures: [],
      counts: { processes: 2, lifecycles: 1, subjects: 1, executions: 0 } };
    expect(WorkflowAcceptanceLifecycleObservationEvaluation.safeParse(value).success).toBe(true);
    expect(WorkflowAcceptanceLifecycleObservationEvaluation.safeParse({ ...value, cleanupPermitted: true }).success).toBe(false);
    expect(WorkflowAcceptanceLifecycleObservationEvaluation.safeParse({ ...value, natural: true }).success).toBe(false);
  });
  it("全量结果不能遗漏子进程", () => {
    expect(WorkflowAcceptanceLifecycleObservationEvaluation.safeParse({ version: 1, status: "consistent", cleanupPermitted: false,
      failures: [], counts: { processes: 2, lifecycles: 1, subjects: 0, executions: 0 } }).success).toBe(false);
  });
  it("调用上限必须对应实际Node生命周期数量", () => {
    const value = { version: 1, status: "consistent", cleanupPermitted: false, failures: [],
      counts: { processes: 1, lifecycles: 1, subjects: 0, executions: 512 } };
    expect(WorkflowAcceptanceLifecycleObservationEvaluation.safeParse(value).success).toBe(true);
    expect(WorkflowAcceptanceLifecycleObservationEvaluation.safeParse({ ...value, counts: { ...value.counts, executions: 513 } }).success).toBe(false);
  });
  it("不触发请求访问器", () => {
    let calls = 0; const value = request();
    Object.defineProperty(value, "phase", { get() { calls++; return "business"; }, enumerable: true });
    expect(WorkflowAcceptanceLifecycleObservationRequest.safeParse(value).success).toBe(false); expect(calls).toBe(0);
  });
  it("不调用toJSON", () => {
    let calls = 0;
    expect(WorkflowAcceptanceLifecycleObservationRequest.safeParse({ ...request(), toJSON() { calls++; return request(); } }).success).toBe(false);
    expect(calls).toBe(0);
  });
});
