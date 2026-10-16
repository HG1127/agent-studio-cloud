import { toolStepIdempotencyKey } from "./tool-step-idempotency-key";
import { TOOL_OPERATION_LEASE_MS } from "./tool-operation";

export type DefaultHttpStepIdentity = { stepId: string; stepStartedAt: Date; attempt: number };

export function defaultHttpStepOperationKey(args: {
  workspaceId: string; toolId: string; action: string; runId: string; nodeId: string; stepId: string;
}): { ok: true; material: string; idempotencyKey: string } | { ok: false; error: string } {
  const fields = [args.workspaceId, args.toolId, args.action, args.runId, args.nodeId, args.stepId];
  if (fields.some((value) => typeof value !== "string" || !value.length || value.length > 1000 || /[\u0000-\u001f\u007f]/.test(value))) {
    return { ok: false, error: "工具步骤执行标识无法确认，不能发起业务操作" };
  }
  return {
    ok: true, material: JSON.stringify(["http-default-step:v1", ...fields]),
    idempotencyKey: toolStepIdempotencyKey(args),
  };
}

function milliseconds(value: Date): number {
  try { return Date.prototype.getTime.call(value); } catch { return NaN; }
}

export function defaultHttpStepRetryDeadline(stepStartedAt: Date, retentionMs: number, now: Date):
  | { ok: true; deadline: Date } | { ok: false; error: string } {
  const started = milliseconds(stepStartedAt);
  const current = milliseconds(now);
  const deadline = started + retentionMs - TOOL_OPERATION_LEASE_MS;
  if (!Number.isSafeInteger(started) || !Number.isSafeInteger(current) || started > current
    || !Number.isSafeInteger(retentionMs) || retentionMs < 300_000 || retentionMs > 31_536_000_000
    || !Number.isSafeInteger(deadline) || !Number.isFinite(new Date(deadline).getTime())) {
    return { ok: false, error: "工具步骤首次执行时间无法确认，不能发起业务操作" };
  }
  return { ok: true, deadline: new Date(deadline) };
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, ordered(child)]));
  }
  return value;
}

// HTTP 独立候选的持久摘要使用固定键序；不得改变现有 MCP 与显式业务操作摘要。
export function defaultHttpStepRequestJson(value: unknown): string {
  const serialized = JSON.stringify(ordered(value));
  if (serialized === undefined) throw new Error("业务操作请求无法生成摘要");
  return serialized;
}
