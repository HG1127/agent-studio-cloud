import { FatalError, RetryableError } from "workflow";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

const MAX_WORKFLOW_ERROR_CHARS = 1_000;

export function safeWorkflowFailureReason(error: unknown, fallback: string): string {
  if (!(error instanceof FatalError) && !(error instanceof RetryableError)) return fallback;
  const message = redactSensitiveText(error.message).trim();
  return message ? message.slice(0, MAX_WORKFLOW_ERROR_CHARS) : fallback;
}

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
