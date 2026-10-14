import { RetryError } from "ai";
import { FatalError, RetryableError } from "workflow";

export function runModelControlError(error: unknown): FatalError | RetryableError | null {
  const pending = [error], seen = new Set<unknown>();
  let retryable: RetryableError | null = null;
  for (let visited = 0; pending.length && visited < 32; visited += 1) {
    const current = pending.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    if (FatalError.is(current)) return current;
    if (RetryableError.is(current)) retryable ??= current;
    else if (RetryError.isInstance(current) && Array.isArray(current.errors)) pending.push(...current.errors.slice(0, 32));
  }
  return retryable;
}
