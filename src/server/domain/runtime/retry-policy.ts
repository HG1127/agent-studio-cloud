const MIN_STEP_ATTEMPTS = 1;
export const MAX_STEP_ATTEMPTS = 8;
const DEFAULT_BACKOFF_MS = 5_000;
const MIN_BACKOFF_MS = 50;
const MAX_BACKOFF_MS = 60_000;

type RetryableNodeConfig = {
  retry?: { maxAttempts: number; backoffMs: number };
  tool?: { maxRetries: number };
};

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value!)));
}

export function resolveToolRetryPolicy(node: RetryableNodeConfig): { maxAttempts: number; backoffMs: number } {
  return {
    // 兼容旧系统语义：tool.maxRetries 表示包含首次调用在内的最大尝试次数。
    maxAttempts: boundedInteger(node.retry?.maxAttempts ?? node.tool?.maxRetries, 1, MIN_STEP_ATTEMPTS, MAX_STEP_ATTEMPTS),
    backoffMs: boundedInteger(node.retry?.backoffMs, DEFAULT_BACKOFF_MS, MIN_BACKOFF_MS, MAX_BACKOFF_MS),
  };
}

export function canRetryStep(attempt: number, maxAttempts: number): boolean {
  return boundedInteger(attempt, 1, MIN_STEP_ATTEMPTS, MAX_STEP_ATTEMPTS) < maxAttempts;
}
