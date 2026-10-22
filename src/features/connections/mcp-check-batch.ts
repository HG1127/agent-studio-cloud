import {
  McpConnectionCheckResult,
  McpConnectionListResult,
  type McpConnectionView,
} from "@/contracts/mcp-connection";

export type McpCheckState =
  | { kind: "unknown" }
  | { kind: "checking"; previous?: McpConnectionCheckResult }
  | { kind: "uncertain"; previous?: McpConnectionCheckResult }
  | { kind: "result"; result: McpConnectionCheckResult };
export type McpCheckEntry = { connection: McpConnectionView; state: McpCheckState };
export type McpCheckSnapshot = {
  entries: McpCheckEntry[];
  phase: "idle" | "running" | "stopping" | "stopped" | "completed";
  mode: "all" | "single" | null;
  activeId: McpConnectionView["id"] | null;
  completed: number;
  total: number;
};

export function readMcpCheckEntries(connections: McpConnectionView[]): McpConnectionView[] {
  const parsed = McpConnectionListResult.parse({ connections }).connections;
  if (new Set(parsed.map((connection) => connection.id)).size !== parsed.length) {
    throw new Error("登记目录无法逐项核对");
  }
  return parsed;
}

export function reconcileMcpCheckResult(connection: McpConnectionView, value: unknown): McpConnectionCheckResult {
  const result = McpConnectionCheckResult.parse(value);
  if (result.status === "available" || result.status === "definition-changed") {
    // 当前服务端以一条注册工具生成一条登记；名称与标识不能用于推断服务器关系。
    const tool = result.tools[0];
    if (result.tools.length !== 1 || !tool || tool.registryToolId !== connection.id || tool.name !== connection.name
      || (result.status === "available") !== (tool.status === "available")) {
      throw new Error("检查回复与本次登记不一致");
    }
  } else if (result.tools.length !== 0) {
    throw new Error("检查回复与本次登记不一致");
  }
  return result;
}

export function summarizeMcpChecks(entries: McpCheckEntry[]) {
  let passed = 0, failed = 0, unknown = 0;
  for (const { state } of entries) {
    if (state.kind !== "result" || state.result.status === "unavailable") unknown += 1;
    else if (state.result.status === "available") passed += 1;
    else failed += 1;
  }
  return { passed, failed, unknown };
}

export function createMcpCheckBatch(
  connections: McpConnectionView[],
  check: (id: McpConnectionView["id"], signal: AbortSignal) => Promise<McpConnectionCheckResult>,
  onChange: (snapshot: McpCheckSnapshot) => void,
) {
  let snapshot: McpCheckSnapshot = {
    entries: readMcpCheckEntries(connections).map((connection) => ({ connection, state: { kind: "unknown" } })),
    phase: "idle", mode: null, activeId: null, completed: 0, total: 0,
  };
  let disposed = false;
  let active: { controller: AbortController; stopped: boolean } | null = null;
  const publish = (update: Partial<McpCheckSnapshot>) => {
    snapshot = { ...snapshot, ...update };
    if (!disposed) onChange(snapshot);
  };
  const updateEntry = (id: string, state: McpCheckState) => snapshot.entries.map((entry) =>
    entry.connection.id === id ? { ...entry, state } : entry);

  function start(ids: string[], mode: "all" | "single") {
    if (disposed || active || ids.length === 0) return false;
    const operation = { controller: new AbortController(), stopped: false };
    active = operation;
    publish({ phase: "running", mode, completed: 0, total: ids.length });
    void (async () => {
      for (const id of ids) {
        if (disposed || operation.stopped) break;
        const entry = snapshot.entries.find((item) => item.connection.id === id);
        if (!entry) break;
        const previous = entry.state.kind === "result" ? entry.state.result
          : entry.state.kind === "checking" || entry.state.kind === "uncertain" ? entry.state.previous : undefined;
        publish({ activeId: id, entries: updateEntry(id, { kind: "checking", previous }) });
        if (disposed) break;
        if (operation.stopped) {
          publish({ activeId: null, entries: updateEntry(id, entry.state) });
          break;
        }
        let state: McpCheckState;
        try {
          state = { kind: "result", result: reconcileMcpCheckResult(entry.connection, await check(id, operation.controller.signal)) };
        } catch {
          state = { kind: "uncertain", previous };
        }
        if (disposed || active !== operation) return;
        publish({ entries: updateEntry(id, state), activeId: null, completed: snapshot.completed + 1 });
      }
      if (disposed || active !== operation) return;
      active = null;
      publish({ phase: operation.stopped ? "stopped" : "completed", activeId: null });
    })();
    return true;
  }

  return {
    getSnapshot: () => snapshot,
    startAll: () => start(snapshot.entries.map((entry) => entry.connection.id), "all"),
    startOne: (id: string) => snapshot.entries.some((entry) => entry.connection.id === id) && start([id], "single"),
    stop: () => {
      if (disposed || !active || active.stopped || snapshot.mode !== "all") return false;
      active.stopped = true;
      publish({ phase: "stopping" });
      return true;
    },
    dispose: () => {
      disposed = true;
      if (active) { active.stopped = true; active.controller.abort(); }
    },
  };
}

export type McpCheckBatch = ReturnType<typeof createMcpCheckBatch>;
