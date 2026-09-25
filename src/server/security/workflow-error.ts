import { FatalError, RetryableError } from "workflow";

export async function withSafeWorkflowError<T>(
  operation: () => Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FatalError || error instanceof RetryableError) throw error;
    throw new RetryableError(message, { retryAfter: "2s" });
  }
}
