import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES, MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS, WORKFLOW_PROCESS_LIFECYCLE_DIRECTORY,
  WorkflowAcceptanceProcessLifecycle } from "../../src/contracts/workflow-process-lifecycle";
import { createOwnedWorkflowProcessLifecycleWriter } from "../helpers/write-owned-workflow-process-lifecycle";

let fixtureRoot = "", fixtureParent = "", directory = "", owned = false;
beforeEach(() => {
  owned = false; fixtureRoot = ""; fixtureParent = ""; directory = "";
  fixtureParent = fs.realpathSync(os.tmpdir());
  fixtureRoot = fs.mkdtempSync(path.join(fixtureParent, "owned-lifecycle-writer-")); owned = true;
  directory = path.join(fixtureRoot, WORKFLOW_PROCESS_LIFECYCLE_DIRECTORY); fs.mkdirSync(directory, { mode: 0o700 });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (!owned) return;
  const absolute = path.resolve(fixtureRoot), parent = path.resolve(fixtureParent), stat = fs.lstatSync(absolute);
  const key = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (!path.isAbsolute(fixtureRoot) || !path.isAbsolute(fixtureParent) || path.dirname(absolute) !== parent
    || !path.basename(absolute).startsWith("owned-lifecycle-writer-") || !stat.isDirectory() || stat.isSymbolicLink()
    || key(fs.realpathSync(absolute)) !== key(absolute)) throw new Error("拒绝清理非自建写盘样本目录");
  owned = false; fs.rmSync(absolute, { recursive: true, force: false });
});

const id = (value: number) => "00000000-0000-4000-8000-" + String(value).padStart(12, "0");
function record(): WorkflowAcceptanceProcessLifecycle {
  return { version: 1, launch: { context: { version: 1, batchId: id(1), caseId: "harness-retry", sourceCommit: "a".repeat(40),
    sourceFingerprint: "b".repeat(64), executionDomainId: id(9), databaseBranchId: "br-lifecycle-writer-test",
    applicationName: "mvp_wf_" + id(9).replaceAll("-", ""), sdkDirectory: "D:/test-only/sdk" },
  lifecycleId: id(2), processId: process.pid, phase: "bridge", startedAt: "2026-10-14T01:00:00.000Z",
  lifecycleFingerprint: "c".repeat(64), runtimeLaunchId: null }, runtimeInventoryRef: null,
  subjects: [], executions: [], events: [{ sequence: 1, at: "2026-10-14T01:00:00.001Z", type: "node-exit", code: 0 }],
  failures: [], cleanupPermitted: false };
}
function capacityRecord(): WorkflowAcceptanceProcessLifecycle {
  const value = record(), at = (offset: number) => new Date(Date.parse(value.launch.startedAt) + offset).toISOString();
  value.launch.phase = "business";
  value.subjects = [{ subjectId: id(4), kind: "esbuild-service", processId: null, createdAt: at(0), createdAfterSequence: 0 }];
  value.executions = Array.from({ length: 512 }, (_, index) => ({ executionId: id(1000 + index), realmId: id(6),
    target: index === 0 ? "workflow-body" : "retained-resume", parentExecutionId: index === 0 ? null : id(1000) }));
  value.failures = ["execution-observation"];
  value.events = Array.from({ length: MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS - 1 }, (_, index) => ({ sequence: index + 1,
    at: at(index + 1), type: "observation-failed", failure: "execution-observation", subjectId: id(4), executionId: id(1000) }));
  value.events.push({ sequence: MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS, at: at(MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS), type: "node-exit", code: 1 });
  return value;
}
const target = (value: WorkflowAcceptanceProcessLifecycle) => path.join(directory, value.launch.lifecycleId.toLowerCase() + ".json");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const operations = () => ({ ...fs });

describe("生命周期同步最终原文件写盘", () => {
  it("按lifecycleId独占创建文件，回执来自实际读回的UTF8字节", () => {
    const value = record(), io = operations(), open = vi.spyOn(io, "openSync"), close = vi.spyOn(io, "closeSync"), sync = vi.spyOn(io, "fsyncSync");
    const write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io), reference = write(value), raw = fs.readFileSync(target(value));
    expect(reference).toEqual({ lifecycleId: value.launch.lifecycleId, sha256: hash(raw) });
    expect(JSON.parse(raw.toString("utf8"))).toEqual(WorkflowAcceptanceProcessLifecycle.parse(value));
    expect(open.mock.calls.map((call) => call[1])).toEqual(["wx+", "r"]); expect(open.mock.calls[0][2]).toBe(0o600);
    expect(sync).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(2); expect(Object.isFrozen(reference)).toBe(true);
    expect(reference).not.toHaveProperty("natural"); expect(reference).not.toHaveProperty("cleanupPermitted");
  });
  it("缺少来源或runtime原文件仍只写诊断，不补造成功", () => {
    const value = record(); value.launch.phase = "business"; value.launch.lifecycleFingerprint = null;
    value.failures = ["source-observation", "runtime-collection"];
    const reference = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch)(value), actual = JSON.parse(fs.readFileSync(target(value), "utf8"));
    expect(actual.runtimeInventoryRef).toBeNull(); expect(actual.launch.lifecycleFingerprint).toBeNull();
    expect(actual.failures).toEqual(value.failures); expect(reference.sha256).toBe(hash(fs.readFileSync(target(value))));
  });
  it("允许初始化后补入独立来源与同次runtime身份，但不改归属", () => {
    const value = record(); value.launch.phase = "business"; value.launch.lifecycleFingerprint = null;
    const write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch);
    value.launch.lifecycleFingerprint = "d".repeat(64); value.launch.runtimeLaunchId = id(3); value.runtimeInventoryRef = { launchId: id(3), sha256: "e".repeat(64) };
    expect(write(value).sha256).toBe(hash(fs.readFileSync(target(value))));
  });
  it("不会沿用旧launchId命名或忽略严格契约的额外字段", () => {
    const value = record(), io = operations(), open = vi.spyOn(io, "openSync"), write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io);
    expect(() => write({ ...value, launch: { ...value.launch, launchId: id(3) } })).toThrow();
    expect(open).not.toHaveBeenCalled(); expect(fs.readdirSync(directory)).toEqual([]);
  });
  it.each(["lifecycleId", "processId", "phase", "startedAt", "lifecycleFingerprint"] as const)("拒绝初始化后改变%s", (field) => {
    const value = record(), io = operations(), open = vi.spyOn(io, "openSync"), write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io);
    const changed = { ...value, launch: { ...value.launch } };
    if (field === "processId") changed.launch.processId++;
    else if (field === "phase") changed.launch.phase = "migration";
    else if (field === "startedAt") changed.launch.startedAt = "2026-10-14T00:59:59.000Z";
    else if (field === "lifecycleId") changed.launch.lifecycleId = id(4);
    else changed.launch.lifecycleFingerprint = "f".repeat(64);
    expect(WorkflowAcceptanceProcessLifecycle.safeParse(changed).success).toBe(true);
    expect(() => write(changed)).toThrow(); expect(open).not.toHaveBeenCalled();
  });
  it("上下文改变即拒绝，且启动锚不随调用方后续修改", () => {
    const value = record(), io = operations(), open = vi.spyOn(io, "openSync"), write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io);
    value.launch.context.batchId = id(90);
    expect(() => write(value)).toThrow(); expect(open).not.toHaveBeenCalled();
  });
  it("不能冒用其他Node进程建立writer", () => {
    const value = record(); value.launch.processId = process.pid + 1;
    expect(() => createOwnedWorkflowProcessLifecycleWriter(directory, value.launch)).toThrow(); expect(fs.readdirSync(directory)).toEqual([]);
  });
  it("拒绝访问器而不触发getter或打开目标文件", () => {
    const value = record(), io = operations(), open = vi.spyOn(io, "openSync"), write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io);
    let calls = 0; Object.defineProperty(value, "events", { enumerable: true, get() { calls++; throw new Error(); } });
    expect(() => write(value)).toThrow(); expect(calls).toBe(0); expect(open).not.toHaveBeenCalled();
  });
  it("拒绝对象及构造器Proxy而不触发陷阱", () => {
    for (const mode of ["object", "constructor"] as const) {
      const value = record(), io = operations(), open = vi.spyOn(io, "openSync"), write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io);
      let calls = 0;
      const hostile = mode === "object" ? new Proxy(value, { getPrototypeOf() { calls++; throw new Error(); }, ownKeys() { calls++; throw new Error(); } })
        : Object.assign(Object.create(Object.create(null, { constructor: { value: new Proxy(Object, { getOwnPropertyDescriptor() { calls++; throw new Error(); } }) } })), value);
      expect(() => write(hostile)).toThrow(); expect(calls).toBe(0); expect(open).not.toHaveBeenCalled();
    }
  });
  it("JSON私有方法不被调用，且无末态事件的中间快照拒绝", () => {
    const value = record(); let calls = 0;
    const write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch);
    expect(() => write({ ...value, toJSON() { calls++; return value; } })).toThrow(); expect(calls).toBe(0);
    expect(() => createOwnedWorkflowProcessLifecycleWriter(directory, value.launch)({ ...value, events: [] })).toThrow(); expect(fs.readdirSync(directory)).toEqual([]);
  });
  it("大于字符下界预算的值在编码前拒绝", () => {
    const value = record(), write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch);
    const parse = vi.spyOn(WorkflowAcceptanceProcessLifecycle, "safeParse");
    expect(() => write({ ...value, privateDetail: "x".repeat(MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES + 1) })).toThrow();
    expect(parse).not.toHaveBeenCalled(); expect(fs.readdirSync(directory)).toEqual([]);
  });
  it("合法字段组成的临界UTF8记录完整写回，不截断事件或执行列表", () => {
    const value = capacityRecord();
    expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES);
    while (value.executions.length > 1 && Buffer.byteLength(JSON.stringify(value)) > MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES) value.executions.pop();
    const expected = Buffer.from(JSON.stringify(value));
    expect(expected.byteLength).toBeLessThanOrEqual(MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES);
    expect(expected.byteLength).toBeGreaterThan(MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES - 1024);
    expect(WorkflowAcceptanceProcessLifecycle.safeParse(value).success).toBe(true);
    const reference = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch)(value), actual = fs.readFileSync(target(value));
    expect(actual).toEqual(expected); expect(reference.sha256).toBe(hash(actual)); expect(JSON.parse(actual.toString("utf8"))).toEqual(value);
  });
  it("仅合法字段组成的超量记录在打开文件前拒绝", () => {
    const value = capacityRecord(), io = operations(), open = vi.spyOn(io, "openSync");
    expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES);
    expect(() => createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io)(value)).toThrow();
    expect(open).not.toHaveBeenCalled(); expect(fs.readdirSync(directory)).toEqual([]);
  });
  it("一次成功后同一个writer不会重复打开或覆盖文件", () => {
    const value = record(), io = operations(), open = vi.spyOn(io, "openSync"), write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io);
    write(value); const before = fs.readFileSync(target(value));
    expect(() => write(value)).toThrow(); expect(open).toHaveBeenCalledTimes(2); expect(fs.readFileSync(target(value))).toEqual(before);
  });
  it("已有目标文件的内容保留，不通过重建writer绕过wx", () => {
    const value = record(); fs.writeFileSync(target(value), "keep-existing");
    const write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch);
    expect(() => write(value)).toThrow(); expect(fs.readFileSync(target(value), "utf8")).toBe("keep-existing");
  });
  it("已有同名目录不能被当作普通最终文件", () => {
    const value = record(); fs.mkdirSync(target(value));
    expect(() => createOwnedWorkflowProcessLifecycleWriter(directory, value.launch)(value)).toThrow(); expect(fs.lstatSync(target(value)).isDirectory()).toBe(true);
  });
  it("绑定的独占目录被替换时拒绝，旧目录仍保留", () => {
    const value = record(), write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch);
    const retained = path.join(fixtureRoot, "retained-lifecycle"); fs.renameSync(directory, retained); fs.mkdirSync(directory);
    expect(() => write(value)).toThrow(); expect(fs.readdirSync(directory)).toEqual([]); expect(fs.lstatSync(retained).isDirectory()).toBe(true);
  });
  it("错误目录名称和相对路径在创建目标前拒绝", () => {
    const value = record();
    expect(() => createOwnedWorkflowProcessLifecycleWriter(fixtureRoot, value.launch)).toThrow();
    expect(() => createOwnedWorkflowProcessLifecycleWriter(WORKFLOW_PROCESS_LIFECYCLE_DIRECTORY, value.launch)).toThrow();
  });
  it("模拟重解析目录的元数据拒绝，不替代原生符号链接权限验收", () => {
    const value = record(), io = operations(), open = vi.spyOn(io, "openSync");
    vi.spyOn(io, "lstatSync").mockImplementation(((...args: unknown[]) => {
      const stat = Reflect.apply(fs.lstatSync, fs, args);
      if (args[0] !== directory) return stat;
      return Object.create(Object.getPrototypeOf(stat), { ...Object.getOwnPropertyDescriptors(stat), isSymbolicLink: { value: () => true } });
    }) as typeof fs.lstatSync);
    expect(() => createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io)).toThrow(); expect(open).not.toHaveBeenCalled();
  });
  it("同尺寸错误字节不能返回预编码哈希，残留文件不删", () => {
    const value = record(), io = operations();
    vi.spyOn(io, "writeFileSync").mockImplementation((fd, bytes) => { fs.writeFileSync(fd, Buffer.alloc((bytes as Buffer).byteLength, 0x20)); });
    const write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io);
    expect(() => write(value)).toThrow(); expect(fs.existsSync(target(value))).toBe(true); expect(fs.readFileSync(target(value))[0]).toBe(0x20);
  });
  it("编码缓冲区被IO修改也不能改变已固定的预期哈希", () => {
    const value = record(), io = operations();
    vi.spyOn(io, "writeFileSync").mockImplementation((fd, bytes) => { fs.writeFileSync(fd, bytes); (bytes as Buffer)[0] ^= 1; });
    const reference = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io)(value);
    expect(reference.sha256).toBe(hash(fs.readFileSync(target(value)))); expect(JSON.parse(fs.readFileSync(target(value), "utf8"))).toEqual(value);
  });
  it("写入中失败关闭描述符一次，保留部分原文件且不重试", () => {
    const value = record(), io = operations(), close = vi.spyOn(io, "closeSync"), open = vi.spyOn(io, "openSync");
    vi.spyOn(io, "writeFileSync").mockImplementation((fd) => { fs.writeSync(fd as number, "{}"); throw new Error("private-write-fault"); });
    const write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io);
    expect(() => write(value)).toThrow("生命周期原文件写入未确认"); expect(() => write(value)).toThrow();
    expect(close).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledTimes(1); expect(fs.readFileSync(target(value), "utf8")).toBe("{}");
  });
  it("同步刷盘失败不出成功回执", () => {
    const value = record(), io = operations(), close = vi.spyOn(io, "closeSync");
    vi.spyOn(io, "fsyncSync").mockImplementation(() => { throw new Error("private-sync-fault"); });
    expect(() => createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io)(value)).toThrow("生命周期原文件写入未确认");
    expect(close).toHaveBeenCalledTimes(1); expect(fs.existsSync(target(value))).toBe(true);
  });
  it("模拟关闭已生效后报错也不重复关闭或继续读回", () => {
    const value = record(), io = operations(), open = vi.spyOn(io, "openSync");
    const close = vi.spyOn(io, "closeSync").mockImplementation((fd) => { fs.closeSync(fd); throw new Error("private-close-fault"); });
    expect(() => createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io)(value)).toThrow();
    expect(close).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledTimes(1); expect(fs.existsSync(target(value))).toBe(true);
  });
  it("模拟写句柄关闭后更新时间，后续只读阶段采用新时间基线", () => {
    const value = record(), io = operations(); let closes = 0;
    vi.spyOn(io, "closeSync").mockImplementation((fd) => { fs.closeSync(fd); if (++closes === 1) fs.utimesSync(target(value), new Date(0), new Date(0)); });
    expect(createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io)(value).sha256).toBe(hash(fs.readFileSync(target(value))));
  });
  it("原生硬链接使文件单一归属失效，不出回执", () => {
    const value = record(), io = operations();
    vi.spyOn(io, "fsyncSync").mockImplementation((fd) => { fs.fsyncSync(fd); fs.linkSync(target(value), path.join(fixtureRoot, "hard-alias.json")); });
    expect(() => createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io)(value)).toThrow();
    expect(fs.lstatSync(target(value)).nlink).toBe(2);
  });
  it("有界短读累计真实位置，而不是把首个短读当完成", () => {
    const value = record(), io = operations(); const positions: number[] = [];
    vi.spyOn(io, "readSync").mockImplementation(((...args: unknown[]) => {
      const [fd, buffer, offset, length, position] = args as [number, Buffer, number, number, number]; positions.push(position);
      return fs.readSync(fd, buffer, offset, Math.min(length, 13), position);
    }) as typeof fs.readSync);
    const reference = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io)(value);
    expect(positions.length).toBeGreaterThan(2); expect(positions.slice(0, 3)).toEqual([0, 13, 26]); expect(reference.sha256).toBe(hash(fs.readFileSync(target(value))));
  });
  it.each([-1, 1.5, NaN, MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES + 2])("非法实际读长度%s不出回执", (length) => {
    const value = record(), io = operations(), close = vi.spyOn(io, "closeSync");
    vi.spyOn(io, "readSync").mockImplementation((() => length) as typeof fs.readSync);
    expect(() => createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io)(value)).toThrow(); expect(close).toHaveBeenCalledTimes(2);
  });
  it("读取提前EOF不将残缺字节记为完整", () => {
    const value = record(), io = operations(); vi.spyOn(io, "readSync").mockImplementation((() => 0) as typeof fs.readSync);
    expect(() => createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io)(value)).toThrow(); expect(fs.existsSync(target(value))).toBe(true);
  });
  it("IO吞掉重入失败也不能让外层返回成功，已创建原文件保留", () => {
    const value = record(), io = operations();
    vi.spyOn(io, "writeFileSync").mockImplementation((fd, bytes) => { try { write(value); } catch { /* 模拟IO吞掉重入错误。 */ } fs.writeFileSync(fd, bytes); });
    const write = createOwnedWorkflowProcessLifecycleWriter(directory, value.launch, io);
    expect(() => write(value)).toThrow(); expect(() => write(value)).toThrow(); expect(fs.existsSync(target(value))).toBe(true);
  });
});
