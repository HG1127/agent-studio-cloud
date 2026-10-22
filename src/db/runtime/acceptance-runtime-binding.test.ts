import { describe, expect, it, vi } from "vitest";
import { ACCEPTANCE_RUNTIME_PROFILE, ACCEPTANCE_RUNTIME_SYMBOL, AcceptanceRuntimeBindingError,
  readAcceptanceRuntimeBinding } from "./acceptance-runtime-binding";

const realmId = "11111111-1111-4111-8111-111111111111", poolId = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const scope = {}, hub = {
    version: 1, requireRealmIdentity: vi.fn(() => realmId), assertPoolCreationAllowed: vi.fn(() => undefined),
    attachNativeRegistry: vi.fn(() => undefined), recordNativePoolCreation: vi.fn(() => undefined),
    registerNativeRealmInitializer: vi.fn(() => undefined),
  };
  Object.defineProperty(scope, ACCEPTANCE_RUNTIME_SYMBOL, { value: Object.freeze(hub), writable: false, configurable: false });
  return { scope, hub };
}
describe("实际运行观测中心的数据库绑定（仅模拟对象）", () => {
  it("非观测单测模式不触碰scope或加载实际运行中心", () => {
    const trap = vi.fn(() => { throw new Error(); }), scope = new Proxy({}, { getOwnPropertyDescriptor: trap });
    expect(readAcceptanceRuntimeBinding(undefined, scope)).toBeNull(); expect(trap).not.toHaveBeenCalled();
  });
  it("观测模式拒绝Proxy空间且不执行描述符trap", () => {
    const trap = vi.fn(() => { throw new Error("private-native-detail"); });
    const scope = new Proxy({}, { getOwnPropertyDescriptor: trap });
    expect(() => readAcceptanceRuntimeBinding(ACCEPTANCE_RUNTIME_PROFILE, scope)).toThrow(AcceptanceRuntimeBindingError);
    expect(trap).not.toHaveBeenCalled();
  });
  it("保留真实身份、receiver和scope，登记始终使用原中心函数", () => {
    const { scope, hub } = fixture(), binding = readAcceptanceRuntimeBinding(ACCEPTANCE_RUNTIME_PROFILE, scope)!;
    const registry = { close: vi.fn(), snapshot: vi.fn() };
    expect(binding.realmId).toBe(realmId); expect(binding.source).toBe(hub); expect(Object.isFrozen(binding)).toBe(true);
    binding.assertPoolCreationAllowed(); binding.attachNativeRegistry(registry); binding.recordNativePoolCreation(poolId);
    const initializer = vi.fn(); binding.registerNativeRealmInitializer(initializer);
    expect(hub.requireRealmIdentity).toHaveBeenCalledExactlyOnceWith(scope);
    expect(hub.requireRealmIdentity.mock.contexts).toEqual([hub]);
    expect(hub.assertPoolCreationAllowed).toHaveBeenCalledExactlyOnceWith(scope);
    expect(hub.attachNativeRegistry).toHaveBeenCalledExactlyOnceWith(scope, registry);
    expect(hub.recordNativePoolCreation).toHaveBeenCalledExactlyOnceWith(scope, poolId);
    expect(hub.registerNativeRealmInitializer).toHaveBeenCalledExactlyOnceWith(initializer);
    expect(hub.registerNativeRealmInitializer.mock.contexts).toEqual([hub]); expect(initializer).not.toHaveBeenCalled();
    expect(registry.close).not.toHaveBeenCalled(); expect(registry.snapshot).not.toHaveBeenCalled();
  });
  it.each(["", "node", "node-sdk5-v2", false, null])("拒绝未知观测模式 %s", (profile) => {
    const { scope, hub } = fixture();
    expect(() => readAcceptanceRuntimeBinding(profile, scope)).toThrow(AcceptanceRuntimeBindingError);
    expect(hub.requireRealmIdentity).not.toHaveBeenCalled();
  });
  it.each(["missing", "writable", "configurable", "mutable", "version", "getter", "missing-method", "missing-initializer", "proxy"])("拒绝未确认中心 %s", (kind) => {
    const getter = vi.fn(), source = fixture().hub, scope = {};
    let hub: object = source;
    if (kind === "mutable") hub = { ...source };
    if (kind === "version") hub = Object.freeze({ ...source, version: 2 });
    if (kind === "missing-method") hub = Object.freeze({ ...source, recordNativePoolCreation: undefined });
    if (kind === "missing-initializer") hub = Object.freeze({ ...source, registerNativeRealmInitializer: undefined });
    if (kind === "getter") {
      hub = { ...source }; Object.defineProperty(hub, "requireRealmIdentity", { get: getter }); Object.freeze(hub);
    }
    if (kind === "proxy") hub = new Proxy(source, { getOwnPropertyDescriptor: getter });
    if (kind !== "missing") Object.defineProperty(scope, ACCEPTANCE_RUNTIME_SYMBOL,
      { value: hub, writable: kind === "writable", configurable: kind === "configurable" });
    expect(() => readAcceptanceRuntimeBinding(ACCEPTANCE_RUNTIME_PROFILE, scope)).toThrow(AcceptanceRuntimeBindingError);
    expect(getter).not.toHaveBeenCalled(); expect(source.requireRealmIdentity).not.toHaveBeenCalled();
  });
  it.each(["unknown", "throw"])("未知实际空间 %s 不保留原始错误", (kind) => {
    const { scope, hub } = fixture();
    hub.requireRealmIdentity.mockImplementation(() => { if (kind === "throw") throw new Error("private-native-detail"); return "invalid"; });
    try { readAcceptanceRuntimeBinding(ACCEPTANCE_RUNTIME_PROFILE, scope); throw new Error("应拒绝"); }
    catch (error) { expect(error).toBeInstanceOf(AcceptanceRuntimeBindingError); expect(String(error)).not.toContain("private-native-detail"); }
    expect(hub.attachNativeRegistry).not.toHaveBeenCalled(); expect(hub.recordNativePoolCreation).not.toHaveBeenCalled();
  });
  it.each(["assert", "attach", "record", "initialize"])("原生中心 %s 异常固定拒绝、不泄露值", (kind) => {
    const { scope, hub } = fixture(), binding = readAcceptanceRuntimeBinding(ACCEPTANCE_RUNTIME_PROFILE, scope)!;
    const fail = () => { throw new Error("private-native-detail"); };
    if (kind === "assert") hub.assertPoolCreationAllowed.mockImplementation(fail);
    if (kind === "attach") hub.attachNativeRegistry.mockImplementation(fail);
    if (kind === "record") hub.recordNativePoolCreation.mockImplementation(fail);
    if (kind === "initialize") hub.registerNativeRealmInitializer.mockImplementation(fail);
    try {
      if (kind === "assert") binding.assertPoolCreationAllowed();
      if (kind === "attach") binding.attachNativeRegistry({ close: vi.fn(), snapshot: vi.fn() });
      if (kind === "record") binding.recordNativePoolCreation(poolId);
      if (kind === "initialize") binding.registerNativeRealmInitializer(vi.fn());
      throw new Error("应拒绝");
    } catch (error) { expect(error).toBeInstanceOf(AcceptanceRuntimeBindingError); expect(String(error)).not.toContain("private-native-detail"); }
  });
  it("无效池标识不调用实际登记函数", () => {
    const { scope, hub } = fixture(), binding = readAcceptanceRuntimeBinding(ACCEPTANCE_RUNTIME_PROFILE, scope)!;
    expect(() => binding.recordNativePoolCreation("invalid")).toThrow(AcceptanceRuntimeBindingError);
    expect(hub.recordNativePoolCreation).not.toHaveBeenCalled();
  });
});
