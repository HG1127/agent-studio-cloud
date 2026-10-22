import { describe, expect, it } from "vitest";
import { MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES, MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS,
  WorkflowAcceptanceProcessLifecycle, type WorkflowAcceptanceLifecycleEvent } from "./workflow-process-lifecycle";

const id = (value: number) => "00000000-0000-4000-8000-" + String(value).padStart(12, "0");
const at = (value: number) => new Date(Date.parse("2026-10-14T06:30:00.000Z") + value).toISOString();
function record(): WorkflowAcceptanceProcessLifecycle {
  return {
    version: 1, launch: {
      context: { version: 1, batchId: id(1), caseId: "harness-retry", sourceCommit: "a".repeat(40),
        sourceFingerprint: "b".repeat(64), executionDomainId: id(9), databaseBranchId: "br-test-only",
        applicationName: "mvp_wf_" + id(9).replaceAll("-", ""), sdkDirectory: "D:/test-only/sdk" },
      lifecycleId: id(2), processId: 11, phase: "business", startedAt: at(0),
      lifecycleFingerprint: "c".repeat(64), runtimeLaunchId: id(3),
    },
    runtimeInventoryRef: { launchId: id(3), sha256: "d".repeat(64) },
    subjects: [], executions: [], events: [{ sequence: 1, at: at(1), type: "node-exit", code: 0 }],
    failures: [], cleanupPermitted: false,
  };
}
function worker(): WorkflowAcceptanceProcessLifecycle {
  const value = record();
  value.subjects = [{ subjectId: id(4), kind: "vitest-worker", processId: 22, createdAt: at(1), createdAfterSequence: 0 }];
  const actions: WorkflowAcceptanceLifecycleEvent[] = [
    { sequence: 1, at: at(1), type: "spawn", subjectId: id(4), processId: 22 },
    { sequence: 2, at: at(2), type: "stop-requested", subjectId: id(4) },
    { sequence: 3, at: at(3), type: "stopped-ack", subjectId: id(4) },
    { sequence: 4, at: at(4), type: "disconnect-requested", subjectId: id(4) },
    { sequence: 5, at: at(5), type: "disconnected", subjectId: id(4) },
    { sequence: 6, at: at(6), type: "exit", subjectId: id(4), code: 0, signal: null },
    { sequence: 7, at: at(7), type: "stdout-eof", subjectId: id(4) },
    { sequence: 8, at: at(8), type: "stderr-eof", subjectId: id(4) },
    { sequence: 9, at: at(9), type: "close", subjectId: id(4), code: 0, signal: null },
    { sequence: 10, at: at(10), type: "node-exit", code: 0 },
  ];
  value.events = actions; return value;
}
function retained(): WorkflowAcceptanceProcessLifecycle {
  const value = record();
  value.executions = [
    { executionId: id(5), realmId: id(6), target: "workflow-body", parentExecutionId: null },
    { executionId: id(7), realmId: id(6), target: "retained-resume", parentExecutionId: id(5) },
  ];
  value.events = [
    { sequence: 1, at: at(1), type: "vm-enter", executionId: id(5) },
    { sequence: 2, at: at(2), type: "vm-return", executionId: id(5), returnKind: "promise" },
    { sequence: 3, at: at(3), type: "vm-enter", executionId: id(7) },
    { sequence: 4, at: at(4), type: "vm-return", executionId: id(7), returnKind: "promise" },
    { sequence: 5, at: at(5), type: "vm-settled", executionId: id(7), outcome: "fulfilled", resultKind: "suspended" },
    { sequence: 6, at: at(6), type: "vm-sealed" },
    { sequence: 7, at: at(7), type: "node-exit", code: 0 },
  ];
  return value;
}
function nativeService(): WorkflowAcceptanceProcessLifecycle {
  const value = worker(); value.subjects[0].kind = "esbuild-service";
  value.events = [
    value.events[0],
    { sequence: 2, at: at(2), type: "stdin-end-requested", subjectId: id(4) },
    { sequence: 3, at: at(3), type: "stdin-finished", subjectId: id(4) },
    { sequence: 4, at: at(4), type: "stdout-eof", subjectId: id(4) },
    { sequence: 5, at: at(5), type: "exit", subjectId: id(4), code: 0, signal: null },
    { sequence: 6, at: at(6), type: "close", subjectId: id(4), code: 0, signal: null },
    { sequence: 7, at: at(7), type: "node-exit", code: 0 },
  ];
  return value;
}
function insertBeforeExit(value: WorkflowAcceptanceProcessLifecycle, events: WorkflowAcceptanceLifecycleEvent[]) {
  value.events.splice(value.events.length - 1, 0, ...events);
  value.events = value.events.map((event, index) => ({ ...event, sequence: index + 1, at: at(index + 1) }));
}
const accepts = (value: unknown) => WorkflowAcceptanceProcessLifecycle.safeParse(value).success;

describe("独立进程生命周期原始记录契约", () => {
  it("原始零退出记录仍不授予清理，也不自报自然停止", () => {
    const parsed = WorkflowAcceptanceProcessLifecycle.parse(record());
    expect(parsed.cleanupPermitted).toBe(false);
    expect(parsed).not.toHaveProperty("natural");
    expect(parsed).not.toHaveProperty("passed");
    expect(parsed).not.toHaveProperty("disposed");
  });
  it.each(["bridge", "migration"] as const)("未启用执行引擎的%s角色不伪造运行原文件", (phase) => {
    const value = record(); value.launch.phase = phase; value.launch.runtimeLaunchId = null; value.runtimeInventoryRef = null;
    expect(accepts(value)).toBe(true);
  });
  it("保留未知启动PID和原始非零退出，不记成零或完成", () => {
    const value = record(); value.subjects = [{ subjectId: id(4), kind: "esbuild-service", processId: null, createdAt: at(0), createdAfterSequence: 0 }];
    value.launch.lifecycleFingerprint = null; value.launch.runtimeLaunchId = null; value.runtimeInventoryRef = null;
    value.failures = ["native-observation", "runtime-collection"];
    value.events = [{ sequence: 1, at: at(1), type: "node-exit", code: 1 }];
    const parsed = WorkflowAcceptanceProcessLifecycle.parse(value);
    expect(parsed.subjects[0].processId).toBeNull(); expect(parsed.events[0]).toMatchObject({ code: 1 });
  });
  it("worker停止回执与原生事件均保留", () => { expect(accepts(worker())).toBe(true); });
  it("EOF可以先于exit，不能强造同一原生事件总顺序", () => {
    const value = worker(), events = value.events;
    value.events = [events[0], events[1], events[2], events[3], events[4], events[6], events[7], events[5], events[8], events[9]]
      .map((event, index) => ({ ...event, sequence: index + 1, at: at(index + 1) }));
    expect(accepts(value)).toBe(true);
  });
  it("native使用stdin请求及finish，不伪造继承stderr的独立EOF", () => {
    expect(accepts(nativeService())).toBe(true);
  });
  it("恢复返回suspended不冒充原流程Promise结算", () => {
    const parsed = WorkflowAcceptanceProcessLifecycle.parse(retained());
    expect(parsed.events.filter((event) => event.type === "vm-settled")).toHaveLength(1);
    expect(parsed.events).not.toContainEqual(expect.objectContaining({ type: "vm-settled", executionId: id(5) }));
  });
  it("封闭之后原已进入Promise仍可真实结算", () => {
    const value = retained();
    value.events.splice(6, 0, { sequence: 7, at: at(7), type: "vm-settled", executionId: id(5), outcome: "fulfilled", resultKind: null });
    value.events[7] = { sequence: 8, at: at(8), type: "node-exit", code: 0 };
    expect(accepts(value)).toBe(true);
  });
  it("同步抛出也保留实际进入和拒绝结算", () => {
    const value = retained(); value.executions = value.executions.slice(0, 1);
    value.events = [value.events[0],
      { sequence: 2, at: at(2), type: "vm-settled", executionId: id(5), outcome: "rejected", resultKind: null },
      { sequence: 3, at: at(3), type: "node-exit", code: 1 }];
    expect(accepts(value)).toBe(true);
  });
  it.each(["natural", "passed", "disposed", "complete"])("拒绝自报%s字段", (name) => { expect(accepts({ ...record(), [name]: true })).toBe(false); });
  it.each([true, null, undefined])("拒绝清理许可%s", (cleanupPermitted) => { expect(accepts({ ...record(), cleanupPermitted })).toBe(false); });
  it.each(["lifecycleId", "processId"] as const)("根%s不能被子对象冒用", (field) => {
    const value = worker();
    Object.assign(value.subjects[0], field === "lifecycleId" ? { subjectId: value.launch.lifecycleId } : { processId: value.launch.processId });
    expect(accepts(value)).toBe(false);
  });
  it("重复subject或PID不能通过", () => {
    const value = worker(); value.subjects.push({ ...value.subjects[0] }); expect(accepts(value)).toBe(false);
    value.subjects[1].subjectId = id(8); expect(accepts(value)).toBe(false);
  });
  it("已有PID必须对应真实spawn事件", () => {
    const value = worker(); value.events.shift(); value.events = value.events.map((event, index) => ({ ...event, sequence: index + 1 }));
    expect(accepts(value)).toBe(false);
  });
  it("运行原文件不能指向其他启动", () => { const value = record(); value.runtimeInventoryRef!.launchId = id(8); expect(accepts(value)).toBe(false); });
  it("非执行引擎角色不能附加SDK启动或VM执行", () => {
    const value = retained(); value.launch.phase = "bridge"; expect(accepts(value)).toBe(false);
    value.launch.runtimeLaunchId = null; value.runtimeInventoryRef = null; expect(accepts(value)).toBe(false);
  });
  it.each(["stop-requested", "stderr-eof"] as const)("native合法记录中单独拒绝%s", (type) => {
    const value = nativeService(); expect(accepts(value)).toBe(true);
    insertBeforeExit(value, [{ sequence: 1, at: at(1), subjectId: id(4), type }]);
    expect(accepts(value)).toBe(false);
  });
  it("native拒绝因果完整的worker停止链，不靠缺少先行请求拒绝", () => {
    const value = nativeService(); expect(accepts(value)).toBe(true);
    insertBeforeExit(value, [
      { sequence: 1, at: at(1), subjectId: id(4), type: "stop-requested" },
      { sequence: 2, at: at(2), subjectId: id(4), type: "stopped-ack" },
      { sequence: 3, at: at(3), subjectId: id(4), type: "disconnect-requested" },
      { sequence: 4, at: at(4), subjectId: id(4), type: "disconnected" },
    ]);
    expect(accepts(value)).toBe(false);
  });
  it("worker保留原停止链，另行拒绝native stdin请求与finish链", () => {
    const value = worker(); expect(accepts(value)).toBe(true);
    insertBeforeExit(value, [{ sequence: 1, at: at(1), subjectId: id(4), type: "stdin-end-requested" }]);
    expect(accepts(value)).toBe(false);
    insertBeforeExit(value, [{ sequence: 1, at: at(1), subjectId: id(4), type: "stdin-finished" }]);
    expect(accepts(value)).toBe(false);
  });
  it("stopped回执缺stop请求不能通过", () => {
    const value = worker();
    value.events = value.events.filter((event) => event.type !== "stop-requested").map((event, index) => ({ ...event, sequence: index + 1 }));
    expect(accepts(value)).toBe(false);
  });
  it("子事件不能早于实际工厂登记", () => {
    const value = worker(); value.subjects[0].createdAfterSequence = 1; expect(accepts(value)).toBe(false);
    value.subjects[0].createdAfterSequence = 0; value.subjects[0].createdAt = at(2); expect(accepts(value)).toBe(false);
  });
  it("登记时刻不能早于它声明的前序事件", () => {
    const value = worker();
    value.events.unshift({ sequence: 1, at: at(1), type: "observation-failed", failure: "native-observation", subjectId: null, executionId: null });
    value.events = value.events.map((event, index) => ({ ...event, sequence: index + 1, at: at(index + 1) }));
    value.subjects[0].createdAfterSequence = 1; value.subjects[0].createdAt = at(0);
    expect(accepts(value)).toBe(false);
    value.subjects[0].createdAt = at(1); expect(accepts(value)).toBe(true);
    value.subjects[0].createdAfterSequence = 0; value.subjects[0].createdAt = at(2);
    expect(accepts(value)).toBe(false);
    value.subjects[0].createdAfterSequence = 1; expect(accepts(value)).toBe(true);
    value.subjects[0].createdAfterSequence = 0; value.subjects[0].createdAt = at(1);
    expect(accepts(value)).toBe(true);
  });
  it("连续事件时刻与序号缺一不可", () => {
    const value = worker(); value.events[1].sequence = 1; expect(accepts(value)).toBe(false);
    value.events[1].sequence = 2; value.events[1].at = at(0); expect(accepts(value)).toBe(false);
  });
  it.each(["exit", "close"])("%s真实非零/信号/未知值保留，但码和信号不能同时已知", (type) => {
    const value = worker(), event = value.events.find((item) => item.type === type)!;
    Object.assign(event, { code: null, signal: "SIGTERM" }); expect(accepts(value)).toBe(true);
    Object.assign(event, { code: null, signal: null }); expect(accepts(value)).toBe(true);
    Object.assign(event, { code: 1, signal: null }); expect(accepts(value)).toBe(true);
    Object.assign(event, { code: 0, signal: "SIGTERM" }); expect(accepts(value)).toBe(false);
  });
  it("最终进程退出不能重复或缺席", () => {
    const value = record(); value.events.push({ sequence: 2, at: at(2), type: "node-exit", code: 0 }); expect(accepts(value)).toBe(false);
    value.events = [{ sequence: 1, at: at(1), type: "vm-sealed" }]; expect(accepts(value)).toBe(false);
  });
  it("空事件列表被受控拒绝，不从safeParse泄漏异常", () => {
    const value = record(); value.events = [];
    expect(() => WorkflowAcceptanceProcessLifecycle.safeParse(value)).not.toThrow();
    expect(accepts(value)).toBe(false);
  });
  it("恢复必须属于同一原执行空间且不能先于原进入", () => {
    const value = retained(); value.executions[1].realmId = id(8); expect(accepts(value)).toBe(false);
    value.executions[1].realmId = id(6); value.events[0] = { sequence: 1, at: at(1), type: "vm-enter", executionId: id(7) };
    expect(accepts(value)).toBe(false);
  });
  it("封闭之后拒绝新的执行进入，但不能据此声明VM销毁", () => {
    const value = retained(); value.events[0] = { sequence: 1, at: at(1), type: "vm-sealed" };
    expect(accepts(value)).toBe(false);
  });
  it("流程body不能冒用恢复状态作为结算结果", () => {
    const value = retained(); Object.assign(value.events[4], { executionId: id(5) }); expect(accepts(value)).toBe(false);
  });
  it("同一调用不能重复返回或结算", () => {
    const value = retained(); Object.assign(value.events[3], { executionId: id(5) }); expect(accepts(value)).toBe(false);
    const second = retained(); second.events.splice(5, 0, { ...second.events[4], sequence: 6, at: at(6) });
    second.events = second.events.map((event, index) => ({ ...event, sequence: index + 1, at: at(index + 1) }));
    expect(accepts(second)).toBe(false);
  });
  it("重复失败码不能通过，静态未知原因可保留", () => {
    const value = record(); value.failures = ["late-entry"]; expect(accepts(value)).toBe(true);
    value.failures.push("late-entry"); expect(accepts(value)).toBe(false);
  });
  it("不读取对象访问器或toJSON", () => {
    let reads = 0;
    const value = Object.defineProperty(record(), "events", { enumerable: true, get: () => { reads++; return []; } });
    expect(accepts(value)).toBe(false); expect(reads).toBe(0);
    const other = Object.defineProperty(record(), "toJSON", { enumerable: true, get: () => { reads++; return () => ({}); } });
    expect(accepts(other)).toBe(false); expect(reads).toBe(0);
  });
  it("constructor访问器或Proxy不被执行", () => {
    let reads = 0;
    const prototype = Object.create(null);
    Object.defineProperty(prototype, "constructor", { get: () => { reads++; return Object; } });
    const accessor = Object.assign(Object.create(prototype), record()); expect(accepts(accessor)).toBe(false);
    const proxy = new Proxy(Object, { getOwnPropertyDescriptor: () => { reads++; throw new Error(); } });
    const second = Object.assign(Object.create(Object.assign(Object.create(null), { constructor: proxy })), record());
    expect(accepts(second)).toBe(false); expect(reads).toBe(0);
  });
  it("稀疏、循环、隐藏及symbol字段不能混入原始数据", () => {
    const sparse = record(); sparse.subjects = new Array(1); expect(accepts(sparse)).toBe(false);
    const cycle = record(); Object.assign(cycle, { loop: cycle }); expect(accepts(cycle)).toBe(false);
    expect(accepts(Object.defineProperty(record(), "hidden", { value: 1 }))).toBe(false);
    expect(accepts(Object.assign(record(), { [Symbol("hidden")]: 1 }))).toBe(false);
  });
  it("合法字段组成的原始记录受UTF8总量限制，不依赖额外字段拒绝", () => {
    const value = record();
    value.subjects = [{ subjectId: id(4), kind: "esbuild-service", processId: null, createdAt: at(0), createdAfterSequence: 0 }];
    value.executions = Array.from({ length: 512 }, (_, index) => ({
      executionId: id(1000 + index), realmId: id(6), target: index === 0 ? "workflow-body" : "retained-resume",
      parentExecutionId: index === 0 ? null : id(1000),
    }));
    value.failures = ["execution-observation"];
    value.events = Array.from({ length: MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS - 1 }, (_, index) => ({
      sequence: index + 1, at: at(index + 1), type: "observation-failed", failure: "execution-observation",
      subjectId: id(4), executionId: id(1000),
    }));
    value.events.push({ sequence: MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS, at: at(MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS), type: "node-exit", code: 1 });
    expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeGreaterThan(MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES);
    expect(accepts(value)).toBe(false);
    value.executions = value.executions.slice(0, 1);
    expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeLessThan(MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES);
    expect(accepts(value)).toBe(true);
  });
  it("事件容量有界，不截断事实列表", () => {
    const value = record(); value.events = Array.from({ length: MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS + 1 },
      (_, index) => ({ sequence: index + 1, at: at(index + 1), type: "node-exit", code: 0 }));
    expect(accepts(value)).toBe(false);
  });
});
