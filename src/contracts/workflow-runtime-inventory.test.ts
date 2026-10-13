import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { WorkflowAcceptanceRuntimeInventory, WorkflowAcceptanceRuntimeCreationEvent, WorkflowAcceptanceRuntimeLaunch,
  MAX_WORKFLOW_RUNTIME_REALMS, MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES } from "./workflow-runtime-inventory";

const id = (digit: string) => digit.repeat(8) + "-" + digit.repeat(4) + "-4" + digit.repeat(3) + "-8" + digit.repeat(3) + "-" + digit.repeat(12);
const owner = id("1"), host = id("4"), creation = id("5"), pool = id("6");
const at = (second: number) => "2026-10-13T10:00:" + String(second).padStart(2, "0") + ".000Z";
function fixture(): WorkflowAcceptanceRuntimeInventory {
  return { version: 1, launch: { version: 1, launchId: id("3"), processId: 123, threadId: 0, startedAt: at(0),
    adapterFingerprint: "a".repeat(64), sdkFactoryFingerprint: "b".repeat(64), configuredVm: "node",
    context: { version: 1, batchId: id("2"), caseId: "harness-retry", sourceCommit: "c".repeat(40), sourceFingerprint: "d".repeat(64),
      executionDomainId: owner, databaseBranchId: "br-own-case", applicationName: "mvp_wf_" + owner.replaceAll("-", ""), sdkDirectory: "D:/owned/case/sdk" } },
    creationEvents: [
      { sequence: 1, creationId: creation, factory: "host", phase: "started", parentRealmId: null, realmId: null, at: at(1), failureCode: null },
      { sequence: 2, creationId: creation, factory: "host", phase: "returned", parentRealmId: null, realmId: host, at: at(2), failureCode: null },
    ], realms: [{ realmId: host, factory: "host", parentRealmId: null, poolCreationIds: [pool],
      poolCloseReceipt: { ownerId: owner, state: "callbacks_completed", poolIds: [pool], completedIds: [pool], failedIds: [], unknownIds: [], cleanupPermitted: false } }],
    handlers: [{ handlerId: id("7"), startedAt: at(3), settledAt: at(5), result: "fulfilled" }], pendingCreationIds: [], failedCreationIds: [], unfinishedHandlerIds: [],
    dispatchStoppedAt: at(6), creationsSealedAt: at(7), collectedAt: at(8), cleanupPermitted: false };
}

function largeFixture(poolsPerRealm: number, extra: number): WorkflowAcceptanceRuntimeInventory {
  const value = fixture(); value.creationEvents = []; value.realms = []; value.launch.context.sdkDirectory = "D:/x";
  const stableId = (index: number, group: string) => index.toString(16).padStart(8, "0") + "-0000-4000-8000-00000000000" + group;
  for (let index = 0; index < 64; index++) {
    const realmId = stableId(index, "a"), creationId = stableId(index, "b");
    const factory = index === 0 ? "host" as const : "node-vm" as const, parentRealmId = index === 0 ? null : stableId(0, "a");
    const poolIds = Array.from({ length: poolsPerRealm + (index < extra ? 1 : 0) }, (_, poolIndex) => stableId(index * 128 + poolIndex, "c"));
    value.creationEvents.push({ sequence: index * 2 + 1, creationId, factory, parentRealmId, phase: "started", realmId: null, at: at(1), failureCode: null },
      { sequence: index * 2 + 2, creationId, factory, parentRealmId, phase: "returned", realmId, at: at(1), failureCode: null });
    value.realms.push({ realmId, factory, parentRealmId, poolCreationIds: poolIds,
      poolCloseReceipt: { ownerId: owner, state: "callbacks_completed", poolIds, completedIds: poolIds, failedIds: [], unknownIds: [], cleanupPermitted: false } });
  }
  return value;
}

function atByteBoundary(): WorkflowAcceptanceRuntimeInventory {
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
  let low = 0, high = 128;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (bytes(largeFixture(middle, 0)) <= MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES) low = middle; else high = middle - 1;
  }
  expect(low).toBeLessThan(128);
  let result = largeFixture(low, 0);
  for (let extra = 1; extra < 64; extra++) {
    const next = largeFixture(low, extra);
    if (bytes(next) > MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES) break;
    result = next;
  }
  const remaining = MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES - bytes(result);
  expect(remaining).toBeLessThan(2044);
  result.launch.context.sdkDirectory += "x".repeat(remaining);
  expect(bytes(result)).toBe(MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES);
  return result;
}

describe("执行空间独立观测事实契约", () => {
  it("结构合法不授予清理，也不生成覆盖布尔值", () => {
    const result = WorkflowAcceptanceRuntimeInventory.parse(fixture());
    expect(result.cleanupPermitted).toBe(false); expect(result).not.toHaveProperty("coverageComplete");
    expect(result.launch.threadId).toBe(0);
  });
  it("保留未返回创建、未结束handler与未知关闭，不把未知变零", () => {
    const value = fixture(); value.creationEvents.pop(); value.realms = [];
    value.pendingCreationIds = [creation]; value.handlers[0].settledAt = null; value.handlers[0].result = "unknown";
    value.unfinishedHandlerIds = [id("7")]; value.dispatchStoppedAt = null; value.creationsSealedAt = null;
    expect(WorkflowAcceptanceRuntimeInventory.parse(value).pendingCreationIds).toEqual([creation]);
  });
  it("实际失败或不支持的QuickJS创建可以记录，但不是支持或通过", () => {
    const value = fixture(); value.creationEvents[0].factory = "quickjs";
    value.creationEvents[1] = { ...value.creationEvents[1], factory: "quickjs", phase: "failed", realmId: null, failureCode: "unsupported-engine" };
    value.realms = []; value.failedCreationIds = [creation];
    expect(WorkflowAcceptanceRuntimeInventory.parse(value).failedCreationIds).toEqual([creation]);
  });
  it.each(["sequence", "return-first", "repeat-start", "metadata", "missing-realm", "repeat-realm", "parent", "pending", "failed"])("拒绝创建清单不一致 %s", (mode) => {
    const value = fixture();
    if (mode === "sequence") value.creationEvents[1].sequence = 3;
    if (mode === "return-first") value.creationEvents = [{ ...value.creationEvents[1], sequence: 1 }];
    if (mode === "repeat-start") value.creationEvents[1] = { ...value.creationEvents[0], sequence: 2 };
    if (mode === "metadata") value.creationEvents[1].factory = "node-vm";
    if (mode === "missing-realm") value.realms = [];
    if (mode === "repeat-realm") value.realms.push({ ...value.realms[0] });
    if (mode === "parent") value.creationEvents[0].parentRealmId = id("8");
    if (mode === "pending") value.pendingCreationIds = [creation];
    if (mode === "failed") value.failedCreationIds = [creation];
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(value).success).toBe(false);
  });
  it.each(["owner", "pool", "unknown-close"])("原生池事实保留准确归属 %s", (mode) => {
    const value = fixture();
    if (mode === "owner") value.realms[0].poolCloseReceipt!.ownerId = id("8");
    if (mode === "pool") value.realms[0].poolCreationIds = [];
    if (mode === "unknown-close") value.realms[0].poolCloseReceipt = null;
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(value).success).toBe(mode === "unknown-close");
  });
  it.each(["unfinished", "duplicate", "time", "dispatch", "seal", "collected", "future"])("拒绝后台或关闭时刻伪证 %s", (mode) => {
    const value = fixture();
    if (mode === "unfinished") value.unfinishedHandlerIds = [id("7")];
    if (mode === "duplicate") value.handlers.push({ ...value.handlers[0] });
    if (mode === "time") value.handlers[0].settledAt = at(1);
    if (mode === "dispatch") value.dispatchStoppedAt = at(3);
    if (mode === "seal") value.creationsSealedAt = at(1);
    if (mode === "collected") value.collectedAt = at(0);
    if (mode === "future") value.handlers[0].settledAt = at(9);
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(value).success).toBe(false);
  });
  it.each(["started-return", "returned-missing", "failed-missing", "failed-return"])("单个创建阶段也校验 %s", (mode) => {
    const event = { ...fixture().creationEvents[0] };
    if (mode === "started-return") event.realmId = host;
    if (mode === "returned-missing") event.phase = "returned";
    if (mode === "failed-missing") event.phase = "failed";
    if (mode === "failed-return") { event.phase = "failed"; event.realmId = host; event.failureCode = "unknown"; }
    expect(WorkflowAcceptanceRuntimeCreationEvent.safeParse(event).success).toBe(false);
  });
  it.each(["unsafe-process", "unsafe-thread", "engine", "fingerprint"])("拒绝无效启动事实 %s", (mode) => {
    const launch = { ...fixture().launch };
    if (mode === "unsafe-process") launch.processId = 0x100000000;
    if (mode === "unsafe-thread") launch.threadId = Number.MAX_SAFE_INTEGER + 1;
    const input = mode === "engine" ? { ...launch, configuredVm: "quickjs" }
      : mode === "fingerprint" ? { ...launch, adapterFingerprint: "A".repeat(64) } : launch;
    expect(WorkflowAcceptanceRuntimeLaunch.safeParse(input).success).toBe(false);
  });
  it("支持完整跨VM普通数据，但拒绝getter/toJSON和清理声明", () => {
    const plain = runInNewContext("(" + JSON.stringify(fixture()) + ")");
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(plain).success).toBe(true);
    const getter = vi.fn(); const value = fixture(); Object.defineProperty(value.launch, "processId", { get: getter, enumerable: true });
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(value).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    const serialize = vi.fn(); const prototype = { toJSON: serialize }; Object.setPrototypeOf(value, prototype);
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(value).success).toBe(false); expect(serialize).not.toHaveBeenCalled();
    expect(WorkflowAcceptanceRuntimeInventory.safeParse({ ...fixture(), cleanupPermitted: true }).success).toBe(false);
    expect(WorkflowAcceptanceRuntimeInventory.safeParse({ ...fixture(), coverageComplete: true }).success).toBe(false);
  });
  it("执行空间数量独立于旧连接空间16门槛，但超上限仍拒绝", () => {
    expect(MAX_WORKFLOW_RUNTIME_REALMS).toBeGreaterThan(16);
    const value = fixture(); value.realms = Array.from({ length: MAX_WORKFLOW_RUNTIME_REALMS + 1 }, () => ({ ...value.realms[0] }));
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(value).success).toBe(false);
  });
  it.each(["launch", "inventory"])("跨VM原生原型的缺字段继承getter不会被%s校验执行", (kind) => {
    const getter = vi.fn();
    const value = runInNewContext("const value = " + JSON.stringify(fixture()) + ";"
      + "Object.defineProperty(Object.prototype, 'processId', { get: getter }); delete value.launch.processId; value;", { getter });
    const result = kind === "launch" ? WorkflowAcceptanceRuntimeLaunch.safeParse(value.launch)
      : WorkflowAcceptanceRuntimeInventory.safeParse(value);
    expect(result.success).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it.each(["object", "array"])("%s伪原型构造函数的prototype访问器不能执行", (kind) => {
    const getter = vi.fn(), value = fixture(), constructor = (kind === "array" ? Array : Object).bind(null);
    Object.defineProperty(constructor, "prototype", { get: getter });
    const prototype = kind === "array" ? [] : Object.create(null);
    Object.defineProperty(prototype, "constructor", { value: constructor });
    Object.setPrototypeOf(kind === "array" ? value.creationEvents : value, prototype);
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(value).success).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it("超精确UTF8容量及稀疏数组拒绝，不接受未知大字段", () => {
    expect(WorkflowAcceptanceRuntimeInventory.safeParse({ ...fixture(), extra: "界".repeat(MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES / 2) }).success).toBe(false);
    const value = fixture(); value.creationEvents = new Array(2);
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(value).success).toBe(false);
  });
  it("完整合法结构恰好512KiB可以读取，增加一个中文字符后拒绝", () => {
    const value = atByteBoundary();
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(value).success).toBe(true);
    value.launch.context.sdkDirectory += "界";
    expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBe(MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES + 3);
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(value).success).toBe(false);
  });
});
