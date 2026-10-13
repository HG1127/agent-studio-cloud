import { types } from "node:util";
import { AcceptancePoolCloseReceipt } from "@/contracts/workflow-execution-lifecycle";

export const ACCEPTANCE_RUNTIME_PROFILE = "node-sdk5-v1";
export const ACCEPTANCE_RUNTIME_SYMBOL = Symbol.for("agent-studio.owned-workflow-runtime.v1");
type Registry = { close: () => Promise<AcceptancePoolCloseReceipt>; snapshot: () => AcceptancePoolCloseReceipt };
type Method = (...args: unknown[]) => unknown;

export class AcceptanceRuntimeBindingError extends Error {
  constructor() {
    super("验收运行观测绑定未确认，拒绝创建数据库连接");
    this.name = "AcceptanceRuntimeBindingError";
  }
}

export function readAcceptanceRuntimeBinding(profile: unknown, scope: object) {
  if (profile === undefined) return null;
  try {
    if (profile !== ACCEPTANCE_RUNTIME_PROFILE || types.isProxy(scope)) throw new Error();
    const descriptor = Object.getOwnPropertyDescriptor(scope, ACCEPTANCE_RUNTIME_SYMBOL);
    const hub: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (!descriptor || descriptor.writable !== false || descriptor.configurable !== false || !hub
      || typeof hub !== "object" || types.isProxy(hub) || !Object.isFrozen(hub)
      || Object.getOwnPropertyDescriptor(hub, "version")?.value !== 1) throw new Error();
    const method = (name: string): Method => {
      const own = Object.getOwnPropertyDescriptor(hub, name);
      if (!own || !("value" in own) || typeof own.value !== "function" || types.isProxy(own.value)) throw new Error();
      return own.value as Method;
    };
    const identity = method("requireRealmIdentity"), assertAllowed = method("assertPoolCreationAllowed");
    const attach = method("attachNativeRegistry"), record = method("recordNativePoolCreation");
    const realmId = AcceptancePoolCloseReceipt.shape.poolIds.element.parse(Reflect.apply(identity, hub, [scope]));
    const invoke = (native: Method, args: unknown[]) => {
      try { if (Reflect.apply(native, hub, args) !== undefined) throw new Error(); }
      catch { throw new AcceptanceRuntimeBindingError(); }
    };
    return Object.freeze({
      source: hub, realmId,
      assertPoolCreationAllowed: () => invoke(assertAllowed, [scope]),
      attachNativeRegistry: (registry: Registry) => invoke(attach, [scope, registry]),
      recordNativePoolCreation: (poolId: string) => {
        const parsed = AcceptancePoolCloseReceipt.shape.poolIds.element.safeParse(poolId);
        if (!parsed.success) throw new AcceptanceRuntimeBindingError();
        invoke(record, [scope, parsed.data]);
      },
    });
  } catch { throw new AcceptanceRuntimeBindingError(); }
}
