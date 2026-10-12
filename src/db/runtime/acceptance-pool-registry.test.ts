import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AcceptancePoolCloseReceipt, MAX_ACCEPTANCE_POOLS } from "@/contracts/workflow-execution-lifecycle";
import { AcceptancePoolRegistryError, createAcceptancePoolRegistry } from "./acceptance-pool-registry";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}
async function turns() { for (let index = 0; index < 6; index += 1) await Promise.resolve(); }
function unsafeFactory(value: unknown) { return (() => value) as () => { resource: unknown; close: () => Promise<void> }; }
function expectCode(operation: () => unknown, code: AcceptancePoolRegistryError["code"]) {
  try { operation(); } catch (error) {
    expect(error).toBeInstanceOf(AcceptancePoolRegistryError);
    expect(error).toMatchObject({ code });
    expect(error).not.toHaveProperty("cause");
    return error as AcceptancePoolRegistryError;
  }
  throw new Error("应当拒绝不安全的登记操作");
}
function openReceipt(poolIds: string[] = []) {
  return { ownerId: randomUUID(), state: "open" as const, poolIds, completedIds: [], failedIds: [], unknownIds: [...poolIds], cleanupPermitted: false as const };
}

describe("验收连接关闭回执契约", () => {
  it("四种状态均明确不授权清理，空连接回调完成也不证明整个执行域停止", () => {
    const id = randomUUID();
    const receipts = [
      openReceipt([id]), { ...openReceipt([id]), state: "closing" },
      { ...openReceipt([id]), state: "callbacks_completed", completedIds: [id], unknownIds: [] },
      { ...openReceipt([id]), state: "callback_failed", failedIds: [id], unknownIds: [] },
      { ...openReceipt(), state: "callbacks_completed" }, { ...openReceipt([id]), state: "callback_failed" },
    ];
    for (const receipt of receipts) expect(AcceptancePoolCloseReceipt.parse(receipt).cleanupPermitted).toBe(false);
    expect(AcceptancePoolCloseReceipt.safeParse({ ...openReceipt(), cleanupPermitted: true }).success).toBe(false);
    expect(AcceptancePoolCloseReceipt.safeParse({ ...openReceipt(), resource: {} }).success).toBe(false);
  });

  it.each(["ownerId", "poolIds", "completedIds", "failedIds", "unknownIds"] as const)("%s 拒绝非法 UUID", (field) => {
    const receipt = openReceipt();
    const invalid = { ...receipt, [field]: field === "ownerId" ? "invalid" : ["invalid"] };
    expect(AcceptancePoolCloseReceipt.safeParse(invalid).success).toBe(false);
  });

  it.each(["poolIds", "completedIds", "failedIds", "unknownIds"] as const)("%s 拒绝独立重复列表，包括大小写变体", (field) => {
    const id = randomUUID();
    const receipt = { ...openReceipt([id]), state: "closing", [field]: [id, id.toUpperCase()] };
    expect(AcceptancePoolCloseReceipt.safeParse(receipt).success).toBe(false);
  });

  it("拒绝未登记标识、交叉分类及遗漏分类", () => {
    const id = randomUUID(), other = randomUUID();
    expect(AcceptancePoolCloseReceipt.safeParse({ ...openReceipt([id]), state: "closing", completedIds: [other], unknownIds: [] }).success).toBe(false);
    expect(AcceptancePoolCloseReceipt.safeParse({ ...openReceipt([id]), state: "closing", completedIds: [id] }).success).toBe(false);
    expect(AcceptancePoolCloseReceipt.safeParse({ ...openReceipt([id]), unknownIds: [] }).success).toBe(false);
  });

  it("拒绝与状态不一致的结果及超出容量的登记列表", () => {
    const id = randomUUID();
    expect(AcceptancePoolCloseReceipt.safeParse({ ...openReceipt([id]), completedIds: [id], unknownIds: [] }).success).toBe(false);
    expect(AcceptancePoolCloseReceipt.safeParse({ ...openReceipt([id]), state: "callbacks_completed" }).success).toBe(false);
    expect(AcceptancePoolCloseReceipt.safeParse({ ...openReceipt([id]), state: "callbacks_completed", failedIds: [id], unknownIds: [] }).success).toBe(false);
    expect(AcceptancePoolCloseReceipt.safeParse({ ...openReceipt(), state: "callback_failed" }).success).toBe(false);
    expect(AcceptancePoolCloseReceipt.safeParse(openReceipt(Array.from({ length: MAX_ACCEPTANCE_POOLS + 1 }, () => randomUUID()))).success).toBe(false);
  });
});

describe("每所属执行方独立的连接登记与关闭回调原语（不连接数据库）", () => {
  it("调用同步 factory 前已有未知登记，返回资源保持原 identity", () => {
    const ownerId = randomUUID(), poolId = randomUUID();
    const registry = createAcceptancePoolRegistry(ownerId);
    const resource = { dsn: "test-only-opaque-connection-data" };
    const close = vi.fn(async () => undefined);
    const create = vi.fn(() => {
      expect(registry.snapshot()).toEqual({ ownerId, state: "open", poolIds: [poolId], completedIds: [], failedIds: [], unknownIds: [poolId], cleanupPermitted: false });
      return { resource, close };
    });
    expect(registry.createPool(poolId, create)).toBe(resource);
    expect(create).toHaveBeenCalledExactlyOnceWith();
    expect(close).not.toHaveBeenCalled();
    expect(registry.snapshot().unknownIds).toEqual([poolId]);
  });

  it.each(["invalid", "", null, 3])("非法 owner %s 在任何资源 factory 之前拒绝", (owner) => {
    const create = vi.fn(() => ({ resource: {}, close: async () => undefined }));
    expectCode(() => createAcceptancePoolRegistry(owner).createPool(randomUUID(), create), "invalid-owner");
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["invalid", "", null, 3])("非法 pool %s 在资源 factory 之前拒绝且不新增登记", (poolId) => {
    const registry = createAcceptancePoolRegistry(randomUUID());
    const create = vi.fn(() => ({ resource: {}, close: async () => undefined }));
    expectCode(() => registry.createPool(poolId, create), "invalid-pool");
    expect(create).not.toHaveBeenCalled();
    expect(registry.snapshot()).toMatchObject({ state: "open", poolIds: [], unknownIds: [] });
  });

  it("重复 pool 大小写变体在第二次 factory 之前拒绝", () => {
    const registry = createAcceptancePoolRegistry(randomUUID()), id = randomUUID();
    registry.createPool(id, () => ({ resource: {}, close: async () => undefined }));
    const duplicate = vi.fn(() => ({ resource: {}, close: async () => undefined }));
    expectCode(() => registry.createPool(id.toUpperCase(), duplicate), "duplicate-pool");
    expect(duplicate).not.toHaveBeenCalled();
    expect(registry.snapshot().poolIds).toEqual([id]);
  });

  it("容量为 128，越界尝试不运行 factory 或丢掉原登记", () => {
    const registry = createAcceptancePoolRegistry(randomUUID());
    const ids = Array.from({ length: MAX_ACCEPTANCE_POOLS }, () => randomUUID());
    for (const id of ids) registry.createPool(id, () => ({ resource: {}, close: async () => undefined }));
    const overflow = vi.fn(() => ({ resource: {}, close: async () => undefined }));
    expectCode(() => registry.createPool(randomUUID(), overflow), "pool-capacity-exceeded");
    expect(overflow).not.toHaveBeenCalled();
    expect(registry.snapshot().poolIds).toEqual(ids);
    expect(registry.snapshot().unknownIds).toEqual(ids);
  });

  it("快照返回独立副本，只有安全回执字段，不暴露资源、回调或连接数据", () => {
    const registry = createAcceptancePoolRegistry(randomUUID()), id = randomUUID();
    const close = vi.fn(async () => undefined);
    registry.createPool(id, () => ({ resource: { dsn: "test-only-opaque-connection-data" }, close }));
    const first = registry.snapshot();
    first.poolIds.push(randomUUID()); first.unknownIds.length = 0; first.completedIds.push(id); first.failedIds.push(id);
    expect(registry.snapshot()).toMatchObject({ state: "open", poolIds: [id], unknownIds: [id], completedIds: [], failedIds: [], cleanupPermitted: false });
    expect(Object.keys(registry.snapshot()).sort()).toEqual(["ownerId", "state", "poolIds", "completedIds", "failedIds", "unknownIds", "cleanupPermitted"].sort());
    expect(JSON.stringify(registry.snapshot())).not.toMatch(/test-only-opaque|resource|close|callback|dsn|error/);
    expect(close).not.toHaveBeenCalled();
  });

  it("封闭是同步的，并发和重复收尾共用同一 Promise，各关闭回调只收零参数一次", async () => {
    const registry = createAcceptancePoolRegistry(randomUUID()), firstId = randomUUID(), secondId = randomUUID();
    const firstClose = vi.fn(async () => undefined), secondClose = vi.fn(async () => undefined);
    registry.createPool(firstId, () => ({ resource: {}, close: firstClose }));
    registry.createPool(secondId, () => ({ resource: {}, close: secondClose }));
    const closing = registry.sealAndCollectCloseCallbacks();
    expect(registry.snapshot().state).toBe("closing");
    const late = vi.fn(() => ({ resource: {}, close: async () => undefined }));
    expectCode(() => registry.createPool(randomUUID(), late), "registry-sealed");
    expect(late).not.toHaveBeenCalled();
    expect(registry.sealAndCollectCloseCallbacks()).toBe(closing);
    const [receipt, repeated] = await Promise.all([closing, registry.sealAndCollectCloseCallbacks()]);
    expect(repeated).toEqual(receipt);
    expect(receipt).toMatchObject({ state: "callbacks_completed", poolIds: [firstId, secondId], completedIds: [firstId, secondId], failedIds: [], unknownIds: [], cleanupPermitted: false });
    expect(firstClose).toHaveBeenCalledExactlyOnceWith(); expect(secondClose).toHaveBeenCalledExactlyOnceWith();
    expect(registry.sealAndCollectCloseCallbacks()).toBe(closing);
    expect(registry.snapshot().cleanupPermitted).toBe(false);
  });

  it("空 registry 回调收集完成仍不授权清理，封闭后不能重新分配", async () => {
    const ownerId = randomUUID(), registry = createAcceptancePoolRegistry(ownerId);
    const receipt = await registry.sealAndCollectCloseCallbacks();
    expect(receipt).toEqual({ ownerId, state: "callbacks_completed", poolIds: [], completedIds: [], failedIds: [], unknownIds: [], cleanupPermitted: false });
    expectCode(() => registry.createPool(randomUUID(), () => ({ resource: {}, close: async () => undefined })), "registry-sealed");
  });

  it("一个关闭回调挂起时保持 closing，不能提前宣称全部回调完成", async () => {
    const registry = createAcceptancePoolRegistry(randomUUID()), id = randomUUID(), pending = deferred();
    const close = vi.fn(() => pending.promise);
    registry.createPool(id, () => ({ resource: {}, close }));
    const closing = registry.sealAndCollectCloseCallbacks();
    let settled = false; void closing.then(() => { settled = true; });
    try {
      await turns();
      expect(settled).toBe(false);
      expect(registry.snapshot()).toMatchObject({ state: "closing", completedIds: [], failedIds: [], unknownIds: [id], cleanupPermitted: false });
      expect(close).toHaveBeenCalledExactlyOnceWith();
    } finally { pending.resolve(); await closing; }
    expect(registry.snapshot()).toMatchObject({ state: "callbacks_completed", completedIds: [id], unknownIds: [] });
  });

  it("一个回调失败仍等待其他挂起回调，固定失败分类不回显敏感异常且重入不重试", async () => {
    const registry = createAcceptancePoolRegistry(randomUUID()), failedId = randomUUID(), pendingId = randomUUID(), pending = deferred();
    const failedClose = vi.fn(async () => { throw new Error("test-only-sensitive-pool-close-error"); });
    const pendingClose = vi.fn(() => pending.promise);
    registry.createPool(failedId, () => ({ resource: {}, close: failedClose }));
    registry.createPool(pendingId, () => ({ resource: {}, close: pendingClose }));
    const closing = registry.sealAndCollectCloseCallbacks();
    let settled = false; void closing.then(() => { settled = true; });
    try {
      await turns();
      expect(settled).toBe(false);
      expect(registry.snapshot()).toMatchObject({ state: "closing", completedIds: [], failedIds: [failedId], unknownIds: [pendingId], cleanupPermitted: false });
      expect(failedClose).toHaveBeenCalledExactlyOnceWith(); expect(pendingClose).toHaveBeenCalledExactlyOnceWith();
      expect(JSON.stringify(registry.snapshot())).not.toContain("test-only-sensitive-pool-close-error");
      expect(registry.sealAndCollectCloseCallbacks()).toBe(closing);
    } finally { pending.resolve(); await closing; }
    expect(await closing).toMatchObject({ state: "callback_failed", completedIds: [pendingId], failedIds: [failedId], unknownIds: [], cleanupPermitted: false });
    expect(await registry.sealAndCollectCloseCallbacks()).toEqual(await closing);
    expect(failedClose).toHaveBeenCalledTimes(1); expect(pendingClose).toHaveBeenCalledTimes(1);
  });

  it("factory 同步抛错保留事先登记的 unknown，封闭新分配并只返回固定安全错误", async () => {
    const registry = createAcceptancePoolRegistry(randomUUID()), id = randomUUID();
    const error = expectCode(() => registry.createPool(id, () => {
      expect(registry.snapshot().unknownIds).toEqual([id]);
      throw new Error("test-only-sensitive-pool-constructor-error");
    }), "pool-creation-failed");
    expect(error.message).toBe("验收连接创建回执无法确认，已封闭后续创建");
    expect(String(error)).not.toContain("test-only-sensitive-pool-constructor-error");
    expect(registry.snapshot()).toMatchObject({ state: "closing", poolIds: [id], unknownIds: [id], completedIds: [], failedIds: [] });
    const next = vi.fn(() => ({ resource: {}, close: async () => undefined }));
    expectCode(() => registry.createPool(randomUUID(), next), "registry-sealed");
    expect(next).not.toHaveBeenCalled();
    expect(await registry.sealAndCollectCloseCallbacks()).toMatchObject({ state: "callback_failed", unknownIds: [id], cleanupPermitted: false });
  });

  it.each([undefined, null, 3, "invalid"])("无效 close %s 保留 unknown 并阻断以后 factory", async (close) => {
    const registry = createAcceptancePoolRegistry(randomUUID()), id = randomUUID();
    expectCode(() => registry.createPool(id, unsafeFactory({ resource: {}, close })), "pool-creation-failed");
    const next = vi.fn(() => ({ resource: {}, close: async () => undefined }));
    expectCode(() => registry.createPool(randomUUID(), next), "registry-sealed");
    expect(next).not.toHaveBeenCalled();
    expect(await registry.sealAndCollectCloseCallbacks()).toMatchObject({ state: "callback_failed", poolIds: [id], unknownIds: [id], completedIds: [], failedIds: [], cleanupPermitted: false });
  });

  it("缺失 close 或 accessor close 不能被当成有效回调", async () => {
    for (const accessor of [false, true]) {
      const registry = createAcceptancePoolRegistry(randomUUID()), id = randomUUID(), getter = vi.fn(() => { throw new Error("test-only-sensitive-getter-error"); });
      const created = { resource: {} };
      if (accessor) Object.defineProperty(created, "close", { get: getter });
      expectCode(() => registry.createPool(id, unsafeFactory(created)), "pool-creation-failed");
      expect(getter).not.toHaveBeenCalled();
      expect(await registry.sealAndCollectCloseCallbacks()).toMatchObject({ state: "callback_failed", unknownIds: [id], cleanupPermitted: false });
    }
  });

  it("async factory 不转换为成功资源；拒绝 Promise 被内部观察且未知登记仍保留", async () => {
    const registry = createAcceptancePoolRegistry(randomUUID()), id = randomUUID(), close = vi.fn(async () => undefined);
    const create = vi.fn(async () => {
      expect(registry.snapshot().unknownIds).toEqual([id]);
      throw new Error("test-only-sensitive-async-factory-error");
    });
    const error = expectCode(() => registry.createPool(id, create as unknown as () => { resource: unknown; close: () => Promise<void> }), "pool-creation-failed");
    expect(String(error)).not.toContain("test-only-sensitive-async-factory-error");
    await turns();
    expect(await registry.sealAndCollectCloseCallbacks()).toMatchObject({ state: "callback_failed", unknownIds: [id], completedIds: [], failedIds: [], cleanupPermitted: false });
    expect(close).not.toHaveBeenCalled();
    const next = vi.fn(() => ({ resource: {}, close }));
    expectCode(() => registry.createPool(randomUUID(), next), "registry-sealed");
    expect(next).not.toHaveBeenCalled();
  });

  it("factory 返回已兑现 Promise 也保留 unknown，不接收其中的资源或关闭回调", async () => {
    const registry = createAcceptancePoolRegistry(randomUUID()), id = randomUUID(), close = vi.fn(async () => undefined);
    expectCode(() => registry.createPool(id, unsafeFactory(Promise.resolve({ resource: {}, close }))), "pool-creation-failed");
    expect(await registry.sealAndCollectCloseCallbacks()).toMatchObject({ state: "callback_failed", unknownIds: [id], cleanupPermitted: false });
    expect(close).not.toHaveBeenCalled();
  });

  it("factory 内重入 seal 等待其返回资源及关闭回调，不遗漏登记或提前完成", async () => {
    const registry = createAcceptancePoolRegistry(randomUUID()), id = randomUUID(), pending = deferred();
    const resource = {}, close = vi.fn(() => pending.promise);
    let closing!: Promise<AcceptancePoolCloseReceipt>;
    let settled = false;
    const returned = registry.createPool(id, () => {
      expect(registry.snapshot().unknownIds).toEqual([id]);
      closing = registry.sealAndCollectCloseCallbacks();
      void closing.then(() => { settled = true; });
      expect(registry.snapshot()).toMatchObject({ state: "closing", unknownIds: [id], completedIds: [] });
      expect(close).not.toHaveBeenCalled();
      return { resource, close };
    });
    expect(returned).toBe(resource);
    expect(registry.sealAndCollectCloseCallbacks()).toBe(closing);
    const next = vi.fn(() => ({ resource: {}, close: async () => undefined }));
    expectCode(() => registry.createPool(randomUUID(), next), "registry-sealed");
    expect(next).not.toHaveBeenCalled();
    try {
      await turns();
      expect(settled).toBe(false);
      expect(close).toHaveBeenCalledExactlyOnceWith();
      expect(registry.snapshot()).toMatchObject({ state: "closing", poolIds: [id], unknownIds: [id], completedIds: [] });
    } finally { pending.resolve(); await closing; }
    expect(await closing).toMatchObject({ state: "callbacks_completed", poolIds: [id], completedIds: [id], unknownIds: [], cleanupPermitted: false });
  });

  it("关闭回调内重入收尾复用已发布 Promise，不重复调用任何 close", async () => {
    const registry = createAcceptancePoolRegistry(randomUUID()), id = randomUUID();
    let closing!: Promise<AcceptancePoolCloseReceipt>;
    const close = vi.fn(async () => { expect(registry.sealAndCollectCloseCallbacks()).toBe(closing); });
    registry.createPool(id, () => ({ resource: {}, close }));
    closing = registry.sealAndCollectCloseCallbacks();
    expect(await closing).toMatchObject({ state: "callbacks_completed", completedIds: [id], cleanupPermitted: false });
    expect(close).toHaveBeenCalledExactlyOnceWith();
  });

  it("factory 重入 seal 后抛错仍保留未知登记，已有有效关闭回调照常收集", async () => {
    const registry = createAcceptancePoolRegistry(randomUUID()), readyId = randomUUID(), failedId = randomUUID();
    const close = vi.fn(async () => undefined);
    registry.createPool(readyId, () => ({ resource: {}, close }));
    let closing!: Promise<AcceptancePoolCloseReceipt>;
    const error = expectCode(() => registry.createPool(failedId, () => {
      closing = registry.sealAndCollectCloseCallbacks();
      expect(registry.snapshot().unknownIds).toEqual([readyId, failedId]);
      throw new Error("test-only-sensitive-reentrant-factory-error");
    }), "pool-creation-failed");
    expect(String(error)).not.toContain("test-only-sensitive-reentrant-factory-error");
    expect(registry.sealAndCollectCloseCallbacks()).toBe(closing);
    expect(await closing).toMatchObject({ state: "callback_failed", poolIds: [readyId, failedId], completedIds: [readyId], failedIds: [], unknownIds: [failedId], cleanupPermitted: false });
    expect(close).toHaveBeenCalledExactlyOnceWith();
    const next = vi.fn(() => ({ resource: {}, close: async () => undefined }));
    expectCode(() => registry.createPool(randomUUID(), next), "registry-sealed");
    expect(next).not.toHaveBeenCalled();
  });

  it("关闭回调同步抛错或返回非 Promise 都失败，不把无回执当成功且不重试", async () => {
    for (const throwing of [false, true]) {
      const registry = createAcceptancePoolRegistry(randomUUID()), id = randomUUID();
      const close = vi.fn(() => { if (throwing) throw new Error("test-only-sensitive-sync-close-error"); });
      registry.createPool(id, unsafeFactory({ resource: {}, close }));
      const closing = registry.sealAndCollectCloseCallbacks();
      expect(await closing).toMatchObject({ state: "callback_failed", failedIds: [id], completedIds: [], unknownIds: [], cleanupPermitted: false });
      expect(await registry.sealAndCollectCloseCallbacks()).toEqual(await closing);
      expect(close).toHaveBeenCalledExactlyOnceWith();
      expect(JSON.stringify(registry.snapshot())).not.toContain("test-only-sensitive-sync-close-error");
    }
  });

  it("相同 pool 标识在两个 owner 的 registry 独立收尾，互不混合", async () => {
    const ownerA = randomUUID(), ownerB = randomUUID(), id = randomUUID();
    const first = createAcceptancePoolRegistry(ownerA), second = createAcceptancePoolRegistry(ownerB);
    const firstClose = vi.fn(async () => undefined), secondClose = vi.fn(async () => undefined);
    first.createPool(id, () => ({ resource: {}, close: firstClose }));
    second.createPool(id, () => ({ resource: {}, close: secondClose }));
    expect(await first.sealAndCollectCloseCallbacks()).toMatchObject({ ownerId: ownerA, completedIds: [id], cleanupPermitted: false });
    expect(second.snapshot()).toMatchObject({ ownerId: ownerB, state: "open", poolIds: [id], unknownIds: [id] });
    expect(secondClose).not.toHaveBeenCalled();
    expect(await second.sealAndCollectCloseCallbacks()).toMatchObject({ ownerId: ownerB, completedIds: [id], cleanupPermitted: false });
    expect(firstClose).toHaveBeenCalledExactlyOnceWith(); expect(secondClose).toHaveBeenCalledExactlyOnceWith();
  });
});
