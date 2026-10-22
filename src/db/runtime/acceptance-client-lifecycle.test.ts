import { randomUUID } from "node:crypto";
import { threadId } from "node:worker_threads";
import { join, parse, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fsMocks = vi.hoisted(() => ({
  close: vi.fn(), fstat: vi.fn(), lstat: vi.fn(), open: vi.fn(), read: vi.fn(), realpath: vi.fn(), write: vi.fn(),
}));
const runtimeMocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./acceptance-runtime-binding", async (importOriginal) => ({
  ...await importOriginal<typeof import("./acceptance-runtime-binding")>(), readAcceptanceRuntimeBinding: runtimeMocks.read,
}));
vi.mock("node:fs", () => ({
  closeSync: fsMocks.close, fstatSync: fsMocks.fstat, lstatSync: fsMocks.lstat, openSync: fsMocks.open,
  readSync: fsMocks.read, realpathSync: fsMocks.realpath, writeFileSync: fsMocks.write,
}));
import * as lifecycle from "./acceptance-client-lifecycle";
import { WorkflowAcceptanceContext } from "@/contracts/workflow-case-acceptance";
import { ACCEPTANCE_RUNTIME_PROFILE } from "./acceptance-runtime-binding";
import type { AcceptancePoolCloseReceipt } from "@/contracts/workflow-execution-lifecycle";

const privateUri = "postgresql://test-user:test-only-private@ep-direct.example.invalid/ci_test?sslmode=require";
function context() {
  const executionDomainId = randomUUID();
  return WorkflowAcceptanceContext.parse({
    version: 1, batchId: randomUUID(), caseId: "public-tool-approval-idempotency",
    sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), executionDomainId,
    databaseBranchId: "br-test-owned", applicationName: "mvp_wf_" + executionDomainId.replaceAll("-", ""),
    sdkDirectory: "D:/test-only/owned-sdk",
  });
}
function configure(value = context()) {
  vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_CONTEXT", JSON.stringify(value));
  vi.stubEnv("MVP_ACCEPTANCE_ISOLATED_DB", "1");
  vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED", privateUri);
  vi.stubEnv("DATABASE_URL_POOLED", "production-value-must-not-be-used");
  vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY", undefined);
  vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", undefined);
  return value;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
}
function fileStat(size: number, ino = 11) {
  return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, nlink: 1, dev: 1, ino, size };
}
function directoryStat() {
  return { ...fileStat(0), isFile: () => false, isDirectory: () => true };
}
function configureInventory() {
  const selected = configure({ ...context(), sdkDirectory: join(parse(resolve(".")).root, "test-only", "owned-sdk") });
  const directory = join(selected.sdkDirectory, "realms"), marker = join(selected.sdkDirectory, "owner-context.json");
  vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY", directory);
  let markerBytes = Buffer.from(JSON.stringify(selected), "utf8"), nextFd = 200;
  const files = new Map<string, Buffer>(), descriptors = new Map<number, string>();
  fsMocks.lstat.mockImplementation((path: string) => path === marker ? fileStat(markerBytes.byteLength) : directoryStat());
  fsMocks.realpath.mockImplementation((path: string) => path);
  fsMocks.open.mockImplementation((path: string, flag: string) => {
    if (flag === "r" && path === marker) return 101;
    if (flag !== "wx" || files.has(path)) throw new Error("测试文件已存在或打开参数无效");
    const descriptor = nextFd++;
    files.set(path, Buffer.alloc(0)); descriptors.set(descriptor, path);
    return descriptor;
  });
  fsMocks.fstat.mockImplementation((descriptor: number) => {
    if (descriptor === 101) return fileStat(markerBytes.byteLength);
    const path = descriptors.get(descriptor);
    if (!path) throw new Error("测试文件描述符未登记");
    return fileStat(files.get(path)!.byteLength, descriptor);
  });
  fsMocks.read.mockImplementation((descriptor: number, buffer: Buffer, offset: number, length: number, position: number) => {
    if (descriptor !== 101) throw new Error("禁止读取非模拟标记");
    const size = Math.min(length, Math.max(0, markerBytes.byteLength - position));
    markerBytes.copy(buffer, offset, position, position + size);
    return size;
  });
  fsMocks.write.mockImplementation((descriptor: number, bytes: Buffer) => {
    const path = descriptors.get(descriptor);
    if (!path) throw new Error("禁止写入非模拟文件");
    files.set(path, Buffer.from(bytes));
  });
  fsMocks.close.mockReturnValue(undefined);
  return { selected, directory, marker, files, replaceMarker: (bytes: Uint8Array) => { markerBytes = Buffer.from(bytes); } };
}
let ownsTestRealm = false;
let expectedCloseFailure: "realm-registration-failed" | "realm-final-write-failed" | null = null;
beforeEach(() => {
  ownsTestRealm = false;
  if (Object.getOwnPropertyDescriptor(globalThis, lifecycle.ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL)) {
    throw new Error("假构造器测试不能覆盖既有执行空间登记");
  }
  ownsTestRealm = true;
  expectedCloseFailure = null;
  runtimeMocks.read.mockReset().mockReturnValue(null);
  for (const mock of Object.values(fsMocks)) mock.mockReset().mockImplementation(() => { throw new Error("文件操作必须显式模拟"); });
  configure();
});
afterEach(async () => {
  if (!ownsTestRealm) return;
  try {
    if (lifecycle.getAcceptanceRealmReceipt()) {
      try { await lifecycle.closeAcceptanceRealmPools(); }
      catch (error) {
        if (!expectedCloseFailure) throw error;
        expect(error).toMatchObject({ code: expectedCloseFailure });
      }
    }
  }
  finally {
    Reflect.deleteProperty(globalThis, lifecycle.ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL);
    ownsTestRealm = false; vi.unstubAllEnvs(); vi.resetModules();
  }
});
describe("原生数据库构造入口的本 realm 验收生命周期（仅假构造器）", () => {
  it("缺目录env的原fake模式不会调用任何Node fs primitive", async () => {
    lifecycle.createAcceptanceAwareDatabaseClient(() => ({ end: async () => undefined }));
    await lifecycle.closeAcceptanceRealmPools();
    for (const mock of Object.values(fsMocks)) expect(mock).not.toHaveBeenCalled();
  });
  it("受控文件注册在factory之前，仅wx新建完整冻结context与realm元数据", async () => {
    const model = configureInventory(), end = vi.fn(async () => undefined);
    lifecycle.createAcceptanceAwareDatabaseClient(() => {
      const current = lifecycle.getAcceptanceRealmReceipt()!;
      const registration = model.files.get(join(model.directory, current.realmId + ".registered.json"));
      expect(registration).toBeDefined();
      expect(JSON.parse(registration!.toString("utf8"))).toEqual({
        version: 1, context: model.selected, realmId: current.realmId, processId: process.pid, threadId,
      });
      expect(current.pools.unknownIds).toHaveLength(1);
      return { end };
    });
    const writes = fsMocks.open.mock.calls.filter(([, flag]) => flag === "wx");
    expect(writes).toHaveLength(1); expect(writes[0][2]).toBe(0o600);
    expect(JSON.stringify([...model.files.values()].map((bytes) => bytes.toString("utf8")))).not.toContain(privateUri);
    await lifecycle.closeAcceptanceRealmPools();
  });
  it("final仅在native回调结束后wx写一次，重复模块及close共享同一Promise", async () => {
    const model = configureInventory(), pending = deferred(), end = vi.fn(() => pending.promise);
    lifecycle.createAcceptanceAwareDatabaseClient(() => ({ end }));
    const current = lifecycle.getAcceptanceRealmReceipt()!, final = join(model.directory, current.realmId + ".final.json");
    const closing = lifecycle.closeAcceptanceRealmPools();
    try {
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
      expect(model.files.has(final)).toBe(false);
      vi.resetModules();
      const repeated = await import("./acceptance-client-lifecycle");
      expect(repeated.closeAcceptanceRealmPools()).toBe(closing);
    } finally { pending.resolve(); }
    const receipt = await closing;
    expect(JSON.parse(model.files.get(final)!.toString("utf8"))).toEqual({ version: 1, context: model.selected, receipt });
    expect(fsMocks.open.mock.calls.filter(([path, flag]) => path === final && flag === "wx")).toHaveLength(1);
    expect(end).toHaveBeenCalledExactlyOnceWith(); expect(receipt.pools.cleanupPermitted).toBe(false);
  });
  it("registered碰撞不覆盖，先存本realm并封闭factory及以后创建", async () => {
    configureInventory();
    const open = fsMocks.open.getMockImplementation()!;
    fsMocks.open.mockImplementation((path: string, flag: string, mode?: number) => {
      if (flag === "wx") {
        expect(lifecycle.getAcceptanceRealmReceipt()).not.toBeNull();
        throw new Error("test-only-private-collision");
      }
      return open(path, flag, mode);
    });
    expectedCloseFailure = "realm-registration-failed";
    const factory = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("验收执行空间登记无法确认");
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("本执行空间已经封闭");
    expect(factory).not.toHaveBeenCalled(); expect(fsMocks.write).not.toHaveBeenCalled();
    await expect(lifecycle.closeAcceptanceRealmPools()).rejects.toMatchObject({ code: expectedCloseFailure });
  });
  it.each(["missing", "not-file", "marker-link", "marker-hardlink", "directory-link", "directory-not-directory", "realpath-shift", "context-mismatch", "oversized", "malformed-json", "invalid-utf8", "descriptor-shift"] as const)(
    "标记/目录%s失败封闭且不调用factory、不泄露path或URI", async (kind) => {
      const model = configureInventory(), lstat = fsMocks.lstat.getMockImplementation()!, fstat = fsMocks.fstat.getMockImplementation()!;
      if (kind === "missing") fsMocks.lstat.mockImplementation((path: string) => { if (path === model.marker) throw new Error(model.marker); return lstat(path); });
      if (kind === "not-file") fsMocks.lstat.mockImplementation((path: string) => path === model.marker ? directoryStat() : lstat(path));
      if (kind === "marker-link") fsMocks.lstat.mockImplementation((path: string) => path === model.marker ? { ...fileStat(1), isSymbolicLink: () => true } : lstat(path));
      if (kind === "marker-hardlink") fsMocks.lstat.mockImplementation((path: string) => path === model.marker ? { ...fileStat(1), nlink: 2 } : lstat(path));
      if (kind === "directory-link") fsMocks.lstat.mockImplementation((path: string) => path === model.directory ? { ...directoryStat(), isSymbolicLink: () => true } : lstat(path));
      if (kind === "directory-not-directory") fsMocks.lstat.mockImplementation((path: string) => path === model.directory ? fileStat(1) : lstat(path));
      if (kind === "realpath-shift") fsMocks.realpath.mockReturnValue(join(model.selected.sdkDirectory, "changed"));
      if (kind === "context-mismatch") model.replaceMarker(Buffer.from(JSON.stringify({ ...model.selected, databaseBranchId: "br-other" })));
      if (kind === "oversized") model.replaceMarker(Buffer.alloc(8193, "x"));
      if (kind === "malformed-json") model.replaceMarker(Buffer.from("{invalid"));
      if (kind === "invalid-utf8") model.replaceMarker(Buffer.from([0xff]));
      if (kind === "descriptor-shift") fsMocks.fstat.mockImplementation((descriptor: number) => descriptor === 101 ? { ...fileStat(1), ino: 999 } : fstat(descriptor));
      expectedCloseFailure = "realm-registration-failed";
      const factory = vi.fn(() => ({ end: async () => undefined }));
      try { lifecycle.createAcceptanceAwareDatabaseClient(factory); throw new Error("应拒绝"); }
      catch (error) {
        expect(error).toMatchObject({ code: expectedCloseFailure });
        expect(String(error)).not.toContain(model.selected.sdkDirectory); expect(String(error)).not.toContain(privateUri);
      }
      expect(factory).not.toHaveBeenCalled(); expect(fsMocks.write).not.toHaveBeenCalled();
      if (kind === "oversized" || kind === "descriptor-shift") expect(fsMocks.read).not.toHaveBeenCalled();
      await expect(lifecycle.closeAcceptanceRealmPools()).rejects.toMatchObject({ code: expectedCloseFailure });
    },
  );
  it("目录必须是本机绝对sdk/realms，外部、相对和含上级的路径不执行fs", () => {
    const model = configureInventory(), factory = vi.fn(() => ({ end: async () => undefined }));
    for (const directory of ["", "relative/realms", join(model.selected.sdkDirectory, "other"), model.directory + "/../realms", "x".repeat(8193)]) {
      vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY", directory);
      expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("登记目录无效");
    }
    expect(factory).not.toHaveBeenCalled();
    for (const mock of Object.values(fsMocks)) expect(mock).not.toHaveBeenCalled();
  });
  it("纯fake接受后不能后来打开目录env，原realm仍以无FS方式关闭", async () => {
    const model = configureInventory();
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY", undefined);
    lifecycle.createAcceptanceAwareDatabaseClient(() => ({ end: async () => undefined }));
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY", model.directory);
    const late = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(late)).toThrow("验收执行域或直接连接已改变");
    expect(late).not.toHaveBeenCalled(); await lifecycle.closeAcceptanceRealmPools();
    for (const mock of Object.values(fsMocks)) expect(mock).not.toHaveBeenCalled();
  });
  it("已登记目录不能清除或替换，旧realm close仍写原freeze目录", async () => {
    const model = configureInventory(), end = vi.fn(async () => undefined);
    lifecycle.createAcceptanceAwareDatabaseClient(() => ({ end }));
    const current = lifecycle.getAcceptanceRealmReceipt()!, late = vi.fn(() => ({ end: async () => undefined }));
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY", undefined);
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(late)).toThrow("验收执行域或直接连接已改变");
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY", join(model.selected.sdkDirectory, "other"));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(late)).toThrow("登记目录无效");
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_CONTEXT", undefined);
    const receipt = await lifecycle.closeAcceptanceRealmPools();
    expect(model.files.has(join(model.directory, current.realmId + ".final.json"))).toBe(true);
    expect(receipt.executionDomainId).toBe(model.selected.executionDomainId);
    expect(late).not.toHaveBeenCalled(); expect(end).toHaveBeenCalledExactlyOnceWith();
  });
  it("接受后标记变更拒绝新factory，native关闭结论与final缺失分开", async () => {
    const model = configureInventory(), end = vi.fn(async () => undefined);
    lifecycle.createAcceptanceAwareDatabaseClient(() => ({ end }));
    model.replaceMarker(Buffer.from(JSON.stringify({ ...model.selected, databaseBranchId: "br-other" })));
    const late = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(late)).toThrow("登记无法确认");
    expectedCloseFailure = "realm-final-write-failed";
    await expect(lifecycle.closeAcceptanceRealmPools()).rejects.toMatchObject({ code: expectedCloseFailure });
    expect(lifecycle.getAcceptanceRealmReceipt()?.pools).toMatchObject({ state: "callbacks_completed", cleanupPermitted: false });
    expect(late).not.toHaveBeenCalled(); expect(end).toHaveBeenCalledExactlyOnceWith();
  });
  it("final写失败固定拒绝且只尝试一次，不改已完成native分类、不覆盖旧文件", async () => {
    const model = configureInventory(), end = vi.fn(async () => undefined);
    lifecycle.createAcceptanceAwareDatabaseClient(() => ({ end }));
    const current = lifecycle.getAcceptanceRealmReceipt()!, final = join(model.directory, current.realmId + ".final.json");
    const open = fsMocks.open.getMockImplementation()!;
    fsMocks.open.mockImplementation((path: string, flag: string, mode?: number) => {
      if (path === final && flag === "wx") throw new Error(privateUri);
      return open(path, flag, mode);
    });
    expectedCloseFailure = "realm-final-write-failed";
    const closing = lifecycle.closeAcceptanceRealmPools();
    await expect(closing).rejects.toMatchObject({ code: expectedCloseFailure });
    expect(lifecycle.closeAcceptanceRealmPools()).toBe(closing);
    expect(lifecycle.getAcceptanceRealmReceipt()?.pools).toMatchObject({ state: "callbacks_completed", failedIds: [], cleanupPermitted: false });
    expect(fsMocks.open.mock.calls.filter(([path, flag]) => path === final && flag === "wx")).toHaveLength(1);
    expect(model.files.has(final)).toBe(false); expect(end).toHaveBeenCalledExactlyOnceWith();
  });
  it("构造unknown会写原unknown分类final，仍不授权清理", async () => {
    const model = configureInventory();
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(() => { throw new Error(privateUri); })).toThrow("创建回执无法确认");
    const receipt = await lifecycle.closeAcceptanceRealmPools();
    expect(receipt.pools.state).toBe("callback_failed"); expect(receipt.pools.unknownIds).toHaveLength(1);
    const final = model.files.get(join(model.directory, receipt.realmId + ".final.json"));
    expect(JSON.parse(final!.toString("utf8"))).toEqual({ version: 1, context: model.selected, receipt });
    expect(final!.toString("utf8")).not.toContain(privateUri); expect(receipt.pools.cleanupPermitted).toBe(false);
  });
  it("native回调失败写failed分类final，不把文件存在当连接成功或清理授权", async () => {
    const model = configureInventory(), end = vi.fn(async () => { throw new Error(privateUri); });
    lifecycle.createAcceptanceAwareDatabaseClient(() => ({ end }));
    const receipt = await lifecycle.closeAcceptanceRealmPools();
    expect(receipt.pools).toMatchObject({ state: "callback_failed", completedIds: [], cleanupPermitted: false });
    expect(receipt.pools.failedIds).toHaveLength(1);
    const final = model.files.get(join(model.directory, receipt.realmId + ".final.json"));
    expect(JSON.parse(final!.toString("utf8"))).toEqual({ version: 1, context: model.selected, receipt });
    expect(final!.toString("utf8")).not.toContain(privateUri); expect(end).toHaveBeenCalledExactlyOnceWith();
  });
  it("读取context只返独立副本；空realm回调收集仍不授权清理", async () => {
    const selected = configure(), read = lifecycle.readAcceptanceContext();
    expect(read).toEqual(selected);
    if (!read) throw new Error("应取得验收上下文");
    read.sdkDirectory = "D:/test-only/changed-copy";
    expect(lifecycle.readAcceptanceContext()).toEqual(selected);
    expect(lifecycle.getAcceptanceRealmReceipt()?.pools.poolIds).toEqual([]);
    const receipt = await lifecycle.closeAcceptanceRealmPools();
    expect(receipt.pools).toMatchObject({ state: "callbacks_completed", poolIds: [], cleanupPermitted: false });
  });
  it("factory之前已有unknown登记；直接URI、固定标签和resource identity不变", () => {
    const selected = configure(), resource = { end: vi.fn(async () => undefined) };
    const factory = vi.fn((uri: string, applicationName: string | null) => {
      expect(uri).toBe(privateUri); expect(applicationName).toBe(selected.applicationName);
      expect(lifecycle.getAcceptanceRealmReceipt()).toMatchObject({
        executionDomainId: selected.executionDomainId, processId: process.pid, threadId,
        pools: { ownerId: selected.executionDomainId, state: "open", cleanupPermitted: false },
      });
      expect(lifecycle.getAcceptanceRealmReceipt()?.pools.unknownIds).toHaveLength(1);
      return resource;
    });
    expect(lifecycle.createAcceptanceAwareDatabaseClient(factory)).toBe(resource);
    expect(factory).toHaveBeenCalledOnce(); expect(resource.end).not.toHaveBeenCalled();
  });
  it("同realm重复模块共用registry及聚合Promise，不遗漏第二个bundle客户端", async () => {
    const first = { end: vi.fn(async () => undefined) }, second = { end: vi.fn(async () => undefined) };
    lifecycle.createAcceptanceAwareDatabaseClient(() => first);
    const realmId = lifecycle.getAcceptanceRealmReceipt()?.realmId;
    vi.resetModules();
    const repeated = await import("./acceptance-client-lifecycle");
    repeated.createAcceptanceAwareDatabaseClient(() => second);
    expect(repeated.getAcceptanceRealmReceipt()?.realmId).toBe(realmId);
    expect(repeated.getAcceptanceRealmReceipt()?.pools.poolIds).toHaveLength(2);
    const closing = lifecycle.closeAcceptanceRealmPools();
    expect(repeated.closeAcceptanceRealmPools()).toBe(closing);
    expect((await closing).pools).toMatchObject({ state: "callbacks_completed", cleanupPermitted: false });
    expect(first.end).toHaveBeenCalledExactlyOnceWith(); expect(second.end).toHaveBeenCalledExactlyOnceWith();
  });
  it("没有context保持生产URI行为，生产URI变化可继续创建但不可转验收", () => {
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_CONTEXT", undefined);
    vi.stubEnv("DATABASE_URL_POOLED", "first-production-uri");
    const resource = { end: vi.fn(async () => undefined) }, factory = vi.fn(() => resource);
    expect(lifecycle.createAcceptanceAwareDatabaseClient(factory)).toBe(resource);
    vi.stubEnv("DATABASE_URL_POOLED", "second-production-uri");
    lifecycle.createAcceptanceAwareDatabaseClient(factory);
    expect(factory.mock.calls).toHaveLength(2);
    expect(factory).toHaveBeenNthCalledWith(1, "first-production-uri", null);
    expect(factory).toHaveBeenNthCalledWith(2, "second-production-uri", null);
    expect(lifecycle.getAcceptanceRealmReceipt()).toBeNull();
    configure();
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("数据库执行模式已改变");
    expect(factory).toHaveBeenCalledTimes(2);
  });
  it("无context缺少pooled URI仍保留原错误且不运行factory", () => {
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_CONTEXT", undefined); vi.stubEnv("DATABASE_URL_POOLED", "");
    const factory = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("缺少 DATABASE_URL_POOLED 环境变量");
    expect(factory).not.toHaveBeenCalled();
  });
  it("非法/空/超限context、非隔离标记、缺direct URI均不回落生产", () => {
    const factory = vi.fn(() => ({ end: async () => undefined }));
    for (const text of ["", "not-json-test-only-private", "x".repeat(8193), JSON.stringify({ ...context(), token: "test-only-private" })]) {
      configure(); vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_CONTEXT", text);
      expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow(lifecycle.AcceptanceClientLifecycleError);
    }
    configure(); vi.stubEnv("MVP_ACCEPTANCE_ISOLATED_DB", "0");
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("未确认隔离");
    configure(); vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED", "");
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("专用直接连接无效");
    expect(factory).not.toHaveBeenCalled(); expect(lifecycle.getAcceptanceRealmReceipt()).toBeNull();
  });
  it("明显pooler及可覆写host/tag的URI配置被拒绝，错误不含连接值", () => {
    const factory = vi.fn(() => ({ end: async () => undefined }));
    for (const uri of [privateUri.replace("ep-direct", "ep-direct-pooler"), privateUri.replace("ep-direct", "pgbouncer"),
      privateUri + "&host=ep-direct-pooler.invalid", privateUri + "&application_name=wrong", "test-only-private"]) {
      configure(); vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED", uri);
      try { lifecycle.createAcceptanceAwareDatabaseClient(factory); throw new Error("应拒绝"); }
      catch (error) { expect(error).toBeInstanceOf(lifecycle.AcceptanceClientLifecycleError); expect(String(error)).not.toContain(uri); }
    }
    expect(factory).not.toHaveBeenCalled();
  });
  it("已有context、URI或模式改变拒下一factory，但原realm仍可关闭", async () => {
    const initial = configure(), factory = vi.fn(() => ({ end: async () => undefined }));
    lifecycle.createAcceptanceAwareDatabaseClient(factory);
    configure(context());
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("验收执行域或直接连接已改变");
    configure(initial); vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED", privateUri.replace("ci_test", "other_test"));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("验收执行域或直接连接已改变");
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_CONTEXT", undefined);
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("数据库执行模式已改变");
    expect(factory).toHaveBeenCalledOnce();
    expect(lifecycle.getAcceptanceRealmReceipt()?.pools.poolIds).toHaveLength(1);
    const receipt = await lifecycle.closeAcceptanceRealmPools();
    expect(receipt.executionDomainId).toBe(initial.executionDomainId);
    expect(receipt.pools).toMatchObject({ state: "callbacks_completed", cleanupPermitted: false });
  });
  it("seal同步阻止新pool，native end只零参数一次，挂起期间不完成回执", async () => {
    const pending = deferred(), end = vi.fn(() => pending.promise);
    lifecycle.createAcceptanceAwareDatabaseClient(() => ({ end }));
    const closing = lifecycle.closeAcceptanceRealmPools();
    expect(end).toHaveBeenCalledExactlyOnceWith();
    const late = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(late)).toThrow("本执行空间已经封闭");
    expect(late).not.toHaveBeenCalled(); expect(lifecycle.closeAcceptanceRealmPools()).toBe(closing);
    let settled = false; void closing.then(() => { settled = true; });
    try {
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
      expect(settled).toBe(false); expect(lifecycle.getAcceptanceRealmReceipt()?.pools.state).toBe("closing");
    } finally { pending.resolve(); await closing; }
    expect(end).toHaveBeenCalledTimes(1);
    expect((await closing).pools).toMatchObject({ state: "callbacks_completed", cleanupPermitted: false });
  });
  it("factory构造中重入seal，晚返回资源立即end但不交给新调用方", async () => {
    const end = vi.fn(async () => undefined);
    let closing!: Promise<import("@/contracts/workflow-case-acceptance").WorkflowAcceptanceRealmReceipt>;
    const factory = vi.fn(() => {
      closing = lifecycle.closeAcceptanceRealmPools();
      expect(lifecycle.getAcceptanceRealmReceipt()?.pools.unknownIds).toHaveLength(1);
      return { end };
    });
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("本执行空间已经封闭");
    expect(end).toHaveBeenCalledExactlyOnceWith();
    expect(lifecycle.closeAcceptanceRealmPools()).toBe(closing);
    expect((await closing).pools).toMatchObject({ state: "callbacks_completed", cleanupPermitted: false });
    expect(end).toHaveBeenCalledTimes(1);
  });
  it("constructor失败保留unknown并封闭所有以后factory，秘密不进错误或回执", async () => {
    const factory = vi.fn(() => { throw new Error(privateUri); });
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("验收连接创建回执无法确认");
    expect(lifecycle.getAcceptanceRealmReceipt()?.pools.unknownIds).toHaveLength(1);
    const next = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(next)).toThrow("本执行空间已经封闭");
    expect(next).not.toHaveBeenCalled();
    const receipt = await lifecycle.closeAcceptanceRealmPools();
    expect(receipt.pools).toMatchObject({ state: "callback_failed", cleanupPermitted: false });
    expect(receipt.pools.unknownIds).toHaveLength(1); expect(JSON.stringify(receipt)).not.toContain(privateUri);
  });
  it("native异步factory不能成为成功client，拒绝Promise已观察且保留unknown", async () => {
    const factory = vi.fn(async () => { throw new Error(privateUri); });
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory as unknown as () => { end: () => Promise<void> }))
      .toThrow("验收连接创建回执无法确认");
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    const receipt = await lifecycle.closeAcceptanceRealmPools();
    expect(receipt.pools).toMatchObject({ state: "callback_failed", completedIds: [], cleanupPermitted: false });
    expect(receipt.pools.unknownIds).toHaveLength(1);
    expect(JSON.stringify(receipt)).not.toContain(privateUri);
  });
  it("原native end失败保留失败分类，不重试、无连接值且不授权清理", async () => {
    const end = vi.fn(async () => { throw new Error(privateUri); });
    lifecycle.createAcceptanceAwareDatabaseClient(() => ({ end }));
    const closing = lifecycle.closeAcceptanceRealmPools(), receipt = await closing;
    expect(lifecycle.closeAcceptanceRealmPools()).toBe(closing);
    expect(receipt.pools).toMatchObject({ state: "callback_failed", cleanupPermitted: false });
    expect(receipt.pools.failedIds).toHaveLength(1); expect(receipt.pools.completedIds).toEqual([]);
    expect(JSON.stringify(receipt)).not.toMatch(/test-only-private|postgresql|resource|directUri|contextKey/);
    expect(end).toHaveBeenCalledExactlyOnceWith();
  });
  it("观测模式使用实际身份、固定registry，unknown记录先于原生factory", async () => {
    const selected = configure(), realmId = randomUUID(), source = Object.freeze({ testOnly: true });
    const runtime = { source, realmId, assertPoolCreationAllowed: vi.fn(), attachNativeRegistry: vi.fn(), recordNativePoolCreation: vi.fn(), registerNativeRealmInitializer: vi.fn() };
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE); runtimeMocks.read.mockReturnValue(runtime);
    const end = vi.fn(async () => undefined), factory = vi.fn(() => {
      const pools = lifecycle.getAcceptanceRealmReceipt()!.pools;
      expect(pools.unknownIds).toHaveLength(1);
      expect(runtime.recordNativePoolCreation).toHaveBeenCalledExactlyOnceWith(pools.poolIds[0]);
      expect(lifecycle.getAcceptanceRealmReceipt()?.realmId).toBe(realmId);
      return { end };
    });
    lifecycle.createAcceptanceAwareDatabaseClient(factory);
    const callbacks = runtime.attachNativeRegistry.mock.calls[0][0];
    expect(Object.isFrozen(callbacks)).toBe(true);
    expect(callbacks.snapshot()).toEqual(lifecycle.getAcceptanceRealmReceipt()!.pools);
    expect(callbacks.snapshot().ownerId).toBe(selected.executionDomainId);
    expect(runtime.attachNativeRegistry.mock.invocationCallOrder[0]).toBeLessThan(runtime.recordNativePoolCreation.mock.invocationCallOrder[0]);
    expect(runtime.recordNativePoolCreation.mock.invocationCallOrder[0]).toBeLessThan(factory.mock.invocationCallOrder[0]);
    expect(runtimeMocks.read).toHaveBeenCalledWith(ACCEPTANCE_RUNTIME_PROFILE, globalThis);
    const pools = await callbacks.close();
    expect(pools).toEqual((await lifecycle.closeAcceptanceRealmPools()).pools);
    expect(pools.cleanupPermitted).toBe(false); expect(end).toHaveBeenCalledExactlyOnceWith();
  });
  it("缺真实观测绑定在任何factory或文件操作前固定拒绝", () => {
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE);
    runtimeMocks.read.mockImplementation(() => { throw new Error(privateUri); });
    const factory = vi.fn(() => ({ end: async () => undefined }));
    try { lifecycle.createAcceptanceAwareDatabaseClient(factory); throw new Error("应拒绝"); }
    catch (error) { expect(error).toMatchObject({ code: "runtime-unconfirmed" }); expect(String(error)).not.toContain(privateUri); }
    expect(factory).not.toHaveBeenCalled(); expect(lifecycle.getAcceptanceRealmReceipt()).toBeNull();
    for (const mock of Object.values(fsMocks)) expect(mock).not.toHaveBeenCalled();
  });
  it("已观测但全域封闭时不创建新state、pool或文件", () => {
    const runtime = { source: {}, realmId: randomUUID(), assertPoolCreationAllowed: vi.fn(() => { throw new Error(privateUri); }),
      attachNativeRegistry: vi.fn(), recordNativePoolCreation: vi.fn(), registerNativeRealmInitializer: vi.fn() };
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE); runtimeMocks.read.mockReturnValue(runtime);
    const factory = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("观测绑定未确认");
    expect(factory).not.toHaveBeenCalled(); expect(runtime.attachNativeRegistry).not.toHaveBeenCalled();
    expect(runtime.recordNativePoolCreation).not.toHaveBeenCalled(); expect(lifecycle.getAcceptanceRealmReceipt()).toBeNull();
  });
  it("真实registry附着失败不执行factory，仍可收集原空realm且无许可", async () => {
    const runtime = { source: {}, realmId: randomUUID(), assertPoolCreationAllowed: vi.fn(),
      attachNativeRegistry: vi.fn(() => { throw new Error(privateUri); }), recordNativePoolCreation: vi.fn(), registerNativeRealmInitializer: vi.fn() };
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE); runtimeMocks.read.mockReturnValue(runtime);
    const factory = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("无法绑定真实执行空间");
    expect(factory).not.toHaveBeenCalled(); expect(runtime.recordNativePoolCreation).not.toHaveBeenCalled();
    const receipt = await lifecycle.closeAcceptanceRealmPools();
    expect(receipt.realmId).toBe(runtime.realmId); expect(receipt.pools.poolIds).toEqual([]); expect(receipt.pools.cleanupPermitted).toBe(false);
  });
  it("native工厂前事实登记失败保留unknown，不漏记或继续factory", async () => {
    const runtime = { source: {}, realmId: randomUUID(), assertPoolCreationAllowed: vi.fn(), attachNativeRegistry: vi.fn(),
      recordNativePoolCreation: vi.fn(() => { throw new Error(privateUri); }), registerNativeRealmInitializer: vi.fn() };
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE); runtimeMocks.read.mockReturnValue(runtime);
    const factory = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("创建回执无法确认");
    expect(factory).not.toHaveBeenCalled();
    const pools = (await lifecycle.closeAcceptanceRealmPools()).pools;
    expect(pools.state).toBe("callback_failed"); expect(pools.unknownIds).toHaveLength(1); expect(pools.cleanupPermitted).toBe(false);
  });
  it.each(["source", "identity", "late-profile", "cleared-profile"])("观测%s改变拒新factory，旧固定native关闭仍可执行", async (kind) => {
    const source = {}, runtime = { source, realmId: randomUUID(), assertPoolCreationAllowed: vi.fn(), attachNativeRegistry: vi.fn(), recordNativePoolCreation: vi.fn(), registerNativeRealmInitializer: vi.fn() };
    if (kind !== "late-profile") {
      vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE); runtimeMocks.read.mockReturnValue(runtime);
    }
    const end = vi.fn(async () => undefined); lifecycle.createAcceptanceAwareDatabaseClient(() => ({ end }));
    if (kind === "source") runtimeMocks.read.mockReturnValue({ ...runtime, source: {} });
    if (kind === "identity") runtimeMocks.read.mockReturnValue({ ...runtime, realmId: randomUUID() });
    if (kind === "late-profile") {
      vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE); runtimeMocks.read.mockReturnValue(runtime);
    }
    if (kind === "cleared-profile") { vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", undefined); runtimeMocks.read.mockReturnValue(null); }
    const late = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(late)).toThrow("观测绑定已改变");
    expect(late).not.toHaveBeenCalled(); await lifecycle.closeAcceptanceRealmPools(); expect(end).toHaveBeenCalledExactlyOnceWith();
  });
  it("观测profile存在但context缺失时绝不回落生产URI", () => {
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE); vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_CONTEXT", undefined);
    const factory = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("观测绑定未确认");
    expect(factory).not.toHaveBeenCalled(); expect(runtimeMocks.read).not.toHaveBeenCalled();
  });
  it("真实空registry初始化模拟空间且模块副本复用同一initializer，不生成PG", async () => {
    const selected = configure(), simulatedScope = {}, source = {}, scopes = [globalThis, simulatedScope];
    type Registry = { close: () => Promise<AcceptancePoolCloseReceipt>; snapshot: () => AcceptancePoolCloseReceipt };
    const callbacks = new Map<object, Registry>();
    let registered: ((scope: object) => void) | undefined;
    const register = vi.fn((initializer: (scope: object) => void) => {
      if (registered) { if (registered !== initializer) throw new Error("测试初始化函数不可替换"); return; }
      registered = initializer; for (const scope of scopes) initializer(scope);
    });
    const runtimes = new Map(scopes.map((scope) => [scope, {
      source, realmId: randomUUID(), assertPoolCreationAllowed: vi.fn(), recordNativePoolCreation: vi.fn(),
      attachNativeRegistry: vi.fn((registry: Registry) => { callbacks.set(scope, registry); }), registerNativeRealmInitializer: register,
    }]));
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE);
    runtimeMocks.read.mockImplementation((profile: string, scope: object) => {
      if (profile !== ACCEPTANCE_RUNTIME_PROFILE || !runtimes.has(scope)) throw new Error("未知模拟空间");
      return runtimes.get(scope);
    });
    try {
      lifecycle.initializeAcceptanceObservedRealm(globalThis);
      expect(callbacks.size).toBe(2);
      for (const [scope, registry] of callbacks) {
        const snapshot = registry.snapshot();
        expect(snapshot.ownerId).toBe(selected.executionDomainId); expect(snapshot.poolIds).toEqual([]);
        expect(snapshot.state).toBe("open"); expect(snapshot.cleanupPermitted).toBe(false);
        expect(Object.getOwnPropertyDescriptor(scope, lifecycle.ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL)?.value.realmId).toBe(runtimes.get(scope)!.realmId);
      }
      const first = registered;
      vi.resetModules(); const repeated = await import("./acceptance-client-lifecycle");
      repeated.initializeAcceptanceObservedRealm(globalThis); repeated.initializeAcceptanceObservedRealm(simulatedScope);
      expect(registered).toBe(first); expect(register.mock.calls.every(([initializer]) => initializer === first)).toBe(true);
      for (const runtime of runtimes.values()) expect(runtime.recordNativePoolCreation).not.toHaveBeenCalled();
      for (const mock of Object.values(fsMocks)) expect(mock).not.toHaveBeenCalled();
    } finally {
      await Promise.all([...callbacks.values()].map((registry) => registry.close()));
      Reflect.deleteProperty(simulatedScope, lifecycle.ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL);
    }
    expect(() => lifecycle.initializeAcceptanceObservedRealm(globalThis)).toThrow("已经封闭");
  });
  it("初始化缺profile或未知模拟空间不创建state或文件", () => {
    const scope = {};
    expect(() => lifecycle.initializeAcceptanceObservedRealm(scope)).toThrow("观测绑定未确认");
    expect(runtimeMocks.read).not.toHaveBeenCalled();
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE);
    runtimeMocks.read.mockImplementation(() => { throw new Error(privateUri); });
    expect(() => lifecycle.initializeAcceptanceObservedRealm(scope)).toThrow("观测绑定未确认");
    expect(Object.getOwnPropertyDescriptor(scope, lifecycle.ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL)).toBeUndefined();
    for (const mock of Object.values(fsMocks)) expect(mock).not.toHaveBeenCalled();
  });
  it("初始化注册失败封闭已建真实registry，拒绝以后factory且不授予清理", async () => {
    const runtime = { source: {}, realmId: randomUUID(), assertPoolCreationAllowed: vi.fn(), attachNativeRegistry: vi.fn(), recordNativePoolCreation: vi.fn(),
      registerNativeRealmInitializer: vi.fn(() => { throw new Error(privateUri); }) };
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE); runtimeMocks.read.mockReturnValue(runtime);
    expect(() => lifecycle.initializeAcceptanceObservedRealm(globalThis)).toThrow("无法绑定真实执行空间");
    const factory = vi.fn(() => ({ end: async () => undefined }));
    expect(() => lifecycle.createAcceptanceAwareDatabaseClient(factory)).toThrow("已经封闭"); expect(factory).not.toHaveBeenCalled();
    const pools = (await lifecycle.closeAcceptanceRealmPools()).pools;
    expect(pools.poolIds).toEqual([]); expect(pools.cleanupPermitted).toBe(false);
  });
  it.each(["getter", "proxy"] as const)("未知空间%s在读取任何状态前拒绝且不泄露原错误", (kind) => {
    const getter = vi.fn(() => { throw new Error(privateUri); });
    const trap = vi.fn(() => { throw new Error(privateUri); });
    const target = {}, untrusted = Object.defineProperty({}, "version", { get: getter });
    Object.defineProperty(target, lifecycle.ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL, { value: untrusted });
    const scope = kind === "proxy" ? new Proxy(target, { getOwnPropertyDescriptor: trap }) : target;
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE", ACCEPTANCE_RUNTIME_PROFILE);
    runtimeMocks.read.mockImplementation(() => { throw new Error(privateUri); });
    try { lifecycle.initializeAcceptanceObservedRealm(scope); throw new Error("应拒绝"); }
    catch (error) {
      expect(error).toBeInstanceOf(lifecycle.AcceptanceClientLifecycleError);
      expect(error).toMatchObject({ code: "runtime-unconfirmed" }); expect(String(error)).not.toContain(privateUri);
    }
    expect(runtimeMocks.read).toHaveBeenCalledExactlyOnceWith(ACCEPTANCE_RUNTIME_PROFILE, scope);
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(target, lifecycle.ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL)?.value).toBe(untrusted);
    expect(lifecycle.getAcceptanceRealmReceipt()).toBeNull();
    for (const mock of Object.values(fsMocks)) expect(mock).not.toHaveBeenCalled();
  });
});
