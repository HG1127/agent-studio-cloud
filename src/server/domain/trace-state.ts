const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "waiting_approval", "waiting_event"]);
const TERMINAL_TRACE_KINDS = new Set(["run.completed", "run.failed", "run.cancelled"]);

export function isTerminalTraceKind(kind: string): boolean {
  return TERMINAL_TRACE_KINDS.has(kind);
}

export function canAppendTraceToRun(status: string, kind: string): boolean {
  if (ACTIVE_RUN_STATUSES.has(status)) return true;
  if (status === "completed") return kind === "run.completed";
  if (status === "failed") return kind === "run.failed";
  if (status === "cancelled") return kind === "run.cancelled";
  return false;
}
