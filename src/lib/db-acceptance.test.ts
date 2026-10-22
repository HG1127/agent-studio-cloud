import { randomUUID } from "node:crypto";
import { join, parse, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ postgres: vi.fn(), drizzle: vi.fn(), end: vi.fn(), fs: vi.fn() }));
vi.mock("node:fs", () => ({
  closeSync: mocks.fs, fstatSync: mocks.fs, lstatSync: mocks.fs, openSync: mocks.fs,
  readSync: mocks.fs, realpathSync: mocks.fs, writeFileSync: mocks.fs,
}));
vi.mock("postgres", () => ({ default: mocks.postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: mocks.drizzle }));
vi.mock("@/db/schema", () => ({ acceptanceTestOnlySchema: true }));
import { ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL, closeAcceptanceRealmPools, getAcceptanceRealmReceipt } from "@/db/runtime/acceptance-client-lifecycle";

const options = { prepare: false, idle_timeout: 30, max_lifetime: 300, connect_timeout: 30 };
const privateUri = "postgresql://test-user:test-only-private@ep-direct.example.invalid/ci_test?sslmode=require";
function configure(sdkDirectory = "D:/test-only/owned-sdk") {
  const executionDomainId = randomUUID(), applicationName = "mvp_wf_" + executionDomainId.replaceAll("-", "");
  vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_CONTEXT", JSON.stringify({
    version: 1, batchId: randomUUID(), caseId: "public-tool-approval-idempotency", sourceCommit: "a".repeat(40),
    sourceFingerprint: "b".repeat(64), executionDomainId, databaseBranchId: "br-test-owned", applicationName,
    sdkDirectory,
  }));
  vi.stubEnv("MVP_ACCEPTANCE_ISOLATED_DB", "1");
  vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED", privateUri);
  vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY", undefined);
  return applicationName;
}
let ownsTestRealm = false;
let expectedCloseFailure = false;
beforeEach(() => {
  ownsTestRealm = false;
  if (Object.getOwnPropertyDescriptor(globalThis, ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL)) {
    throw new Error("数据库mock测试不能覆盖既有执行空间登记");
  }
  ownsTestRealm = true;
  expectedCloseFailure = false;
  vi.resetModules(); vi.clearAllMocks();
  mocks.end.mockReset().mockResolvedValue(undefined);
  mocks.postgres.mockReset().mockReturnValue({ end: mocks.end });
  mocks.drizzle.mockReset().mockReturnValue({ testOnlyDb: true });
  mocks.fs.mockReset().mockImplementation(() => { throw new Error("文件操作必须显式模拟"); });
  vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_CONTEXT", undefined); vi.stubEnv("DATABASE_URL_POOLED", "production-pooled-uri");
  vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY", undefined);
});
afterEach(async () => {
  if (!ownsTestRealm) return;
  try {
    if (getAcceptanceRealmReceipt()) {
      try { await closeAcceptanceRealmPools(); }
      catch (error) {
        if (!expectedCloseFailure) throw error;
        expect(error).toMatchObject({ code: "realm-registration-failed" });
      }
    }
  }
  finally {
    Reflect.deleteProperty(globalThis, ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL);
    ownsTestRealm = false; vi.unstubAllEnvs(); vi.resetModules();
  }
});
describe("唯一 lib/db postgres 入口接线（仅mock，不连接数据库）", () => {
  it("受控目录校验失败在唯一postgres factory前拒绝，所有FS均mock", async () => {
    const sdkDirectory = join(parse(resolve(".")).root, "test-only", "owned-sdk");
    configure(sdkDirectory); vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY", join(sdkDirectory, "realms"));
    expectedCloseFailure = true;
    await expect(import("./db")).rejects.toThrow("验收执行空间登记无法确认");
    expect(mocks.postgres).not.toHaveBeenCalled(); expect(mocks.drizzle).not.toHaveBeenCalled();
    expect(mocks.fs).toHaveBeenCalledOnce();
    await expect(closeAcceptanceRealmPools()).rejects.toMatchObject({ code: "realm-registration-failed" });
  });
  it("未启用context时原生产URI和全部参数逐项不变", async () => {
    const loaded = await import("./db");
    expect(loaded.db).toEqual({ testOnlyDb: true });
    expect(mocks.postgres).toHaveBeenCalledExactlyOnceWith("production-pooled-uri", options);
    expect(mocks.drizzle).toHaveBeenCalledOnce();
    expect(getAcceptanceRealmReceipt()).toBeNull();
  });
  it("没有pooled URI的原错误不变，不构造或包装数据库", async () => {
    vi.stubEnv("DATABASE_URL_POOLED", "");
    await expect(import("./db")).rejects.toThrow("缺少 DATABASE_URL_POOLED 环境变量");
    expect(mocks.postgres).not.toHaveBeenCalled(); expect(mocks.drizzle).not.toHaveBeenCalled();
  });
  it("有效context只用direct URI+固定application_name，factory前已有unknown登记", async () => {
    const applicationName = configure();
    mocks.postgres.mockImplementation(() => {
      expect(getAcceptanceRealmReceipt()?.pools.unknownIds).toHaveLength(1);
      return { end: mocks.end };
    });
    await import("./db");
    expect(mocks.postgres).toHaveBeenCalledExactlyOnceWith(privateUri, { ...options, connection: { application_name: applicationName } });
    expect(mocks.end).not.toHaveBeenCalled();
    expect((await closeAcceptanceRealmPools()).pools.cleanupPermitted).toBe(false);
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith();
  });
  it("重复加载lib仍共用登记，封闭后新lib实例不能构造postgres", async () => {
    configure(); await import("./db"); vi.resetModules(); await import("./db");
    expect(mocks.postgres).toHaveBeenCalledTimes(2);
    expect(getAcceptanceRealmReceipt()?.pools.poolIds).toHaveLength(2);
    await closeAcceptanceRealmPools(); vi.resetModules();
    await expect(import("./db")).rejects.toThrow("本执行空间已经封闭");
    expect(mocks.postgres).toHaveBeenCalledTimes(2); expect(mocks.end).toHaveBeenCalledTimes(2);
  });
  it("验收配置非法或缺direct URI不回落生产，构造器失败保留unknown", async () => {
    configure(); vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED", "");
    await expect(import("./db")).rejects.toThrow("专用直接连接无效");
    expect(mocks.postgres).not.toHaveBeenCalled(); expect(mocks.drizzle).not.toHaveBeenCalled();
    vi.resetModules(); configure(); mocks.postgres.mockImplementation(() => { throw new Error(privateUri); });
    await expect(import("./db")).rejects.toThrow("验收连接创建回执无法确认");
    expect(getAcceptanceRealmReceipt()?.pools.unknownIds).toHaveLength(1);
    const receipt = await closeAcceptanceRealmPools();
    expect(receipt.pools.state).toBe("callback_failed"); expect(JSON.stringify(receipt)).not.toContain(privateUri);
    expect(mocks.drizzle).not.toHaveBeenCalled();
  });
});
