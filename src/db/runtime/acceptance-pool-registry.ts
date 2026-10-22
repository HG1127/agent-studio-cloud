import { AcceptancePoolCloseReceipt, MAX_ACCEPTANCE_POOLS } from "@/contracts/workflow-execution-lifecycle";

const ERROR_MESSAGES = {
  "invalid-owner": "验收连接登记的所属标识无效",
  "invalid-pool": "验收连接标识无效",
  "duplicate-pool": "验收连接标识已经登记",
  "pool-capacity-exceeded": "验收连接登记数量已达上限",
  "registry-sealed": "验收连接登记已封闭，不能再创建连接",
  "pool-creation-failed": "验收连接创建回执无法确认，已封闭后续创建",
} as const;

export class AcceptancePoolRegistryError extends Error {
  constructor(readonly code: keyof typeof ERROR_MESSAGES) {
    super(ERROR_MESSAGES[code]);
    this.name = "AcceptancePoolRegistryError";
  }
}

type Entry = {
  poolId: string;
  result: "unknown" | "completed" | "failed";
  resource?: unknown;
  close?: () => Promise<void>;
  creationFinished: Promise<void>;
  finishCreation: () => void;
};

function consumeNativeFactoryPromise(value: unknown): boolean {
  try {
    void Promise.prototype.then.call(value, () => undefined, () => undefined);
    return true;
  } catch {
    return false;
  }
}

export function createAcceptancePoolRegistry(ownerId: unknown) {
  const owner = AcceptancePoolCloseReceipt.shape.ownerId.safeParse(ownerId);
  if (!owner.success) throw new AcceptancePoolRegistryError("invalid-owner");
  const ownerKey = owner.data;
  const entries = new Map<string, Entry>();
  let sealed = false;
  let state: AcceptancePoolCloseReceipt["state"] = "open";
  let closePromise: Promise<AcceptancePoolCloseReceipt> | undefined;

  function snapshot(): AcceptancePoolCloseReceipt {
    const registered = [...entries.values()];
    return AcceptancePoolCloseReceipt.parse({
      ownerId: ownerKey, state, poolIds: registered.map((entry) => entry.poolId),
      completedIds: registered.filter((entry) => entry.result === "completed").map((entry) => entry.poolId),
      failedIds: registered.filter((entry) => entry.result === "failed").map((entry) => entry.poolId),
      unknownIds: registered.filter((entry) => entry.result === "unknown").map((entry) => entry.poolId),
      cleanupPermitted: false,
    });
  }

  function createPool<T>(poolId: unknown, create: () => { resource: T; close: () => Promise<void> }): T {
    const parsed = AcceptancePoolCloseReceipt.shape.poolIds.element.safeParse(poolId);
    if (!parsed.success) throw new AcceptancePoolRegistryError("invalid-pool");
    if (sealed) throw new AcceptancePoolRegistryError("registry-sealed");
    if (entries.has(parsed.data)) throw new AcceptancePoolRegistryError("duplicate-pool");
    if (entries.size >= MAX_ACCEPTANCE_POOLS) throw new AcceptancePoolRegistryError("pool-capacity-exceeded");
    let finishCreation!: () => void;
    const creationFinished = new Promise<void>((resolve) => { finishCreation = resolve; });
    const entry: Entry = { poolId: parsed.data, result: "unknown", creationFinished, finishCreation };
    entries.set(entry.poolId, entry);
    try {
      const created: unknown = create();
      if (consumeNativeFactoryPromise(created)) throw new Error();
      if (!created || typeof created !== "object" || "then" in created) throw new Error();
      const resource = Object.getOwnPropertyDescriptor(created, "resource");
      const close = Object.getOwnPropertyDescriptor(created, "close");
      if (!resource || !("value" in resource)) throw new Error();
      entry.resource = resource.value;
      if (!close || !("value" in close) || typeof close.value !== "function") throw new Error();
      entry.close = close.value;
      return entry.resource as T;
    } catch {
      sealed = true;
      if (state === "open") state = "closing";
      throw new AcceptancePoolRegistryError("pool-creation-failed");
    } finally {
      entry.finishCreation();
    }
  }

  function sealAndCollectCloseCallbacks(): Promise<AcceptancePoolCloseReceipt> {
    if (closePromise) return closePromise;
    sealed = true;
    state = "closing";
    let finish!: (receipt: AcceptancePoolCloseReceipt) => void;
    closePromise = new Promise<AcceptancePoolCloseReceipt>((resolve) => { finish = resolve; });
    // A factory can seal reentrantly while its registered resource/close callback is still being constructed.
    const callbacks = [...entries.values()].map((entry) => entry.creationFinished.then(async () => {
      const close = entry.close;
      if (!close) return;
      try {
        const acknowledgement = close();
        if (!acknowledgement || typeof acknowledgement.then !== "function") throw new Error();
        await acknowledgement;
        entry.result = "completed";
      } catch {
        entry.result = "failed";
      }
    }));
    void Promise.all(callbacks).then(() => {
      state = [...entries.values()].some((entry) => entry.result !== "completed") ? "callback_failed" : "callbacks_completed";
      finish(snapshot());
    });
    return closePromise;
  }

  return { createPool, snapshot, sealAndCollectCloseCallbacks };
}
