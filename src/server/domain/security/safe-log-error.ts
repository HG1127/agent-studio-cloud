import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

const MAX_LOG_FIELD_CHARS = 2_000;
const DATABASE_ERROR_NAME = /^(?:database|drizzle|neon|postgres|postgresql|pg).*error$/i;
const DATABASE_QUERY_MESSAGE = /(?:^|\n)\s*(?:failed query|params):/i;

function safeText(value: unknown): string {
  return redactSensitiveText(String(value ?? "未知错误")).slice(0, MAX_LOG_FIELD_CHARS);
}

function errorCode(record: Record<string, unknown> | null): string {
  const cause = record?.cause && typeof record.cause === "object"
    ? record.cause as Record<string, unknown>
    : null;
  const value = record?.code ?? cause?.code;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function safeMessage(name: string, message: unknown): string {
  const rawMessage = String(message ?? "未知错误");
  if (DATABASE_ERROR_NAME.test(name) || DATABASE_QUERY_MESSAGE.test(rawMessage)) {
    return "数据库操作失败";
  }
  return safeText(rawMessage);
}

export function safeErrorForLog(error: unknown): { name: string; message: string; code?: string } {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const name = error instanceof Error
    ? error.name
    : typeof record?.name === "string"
      ? record.name
      : "Error";
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === "string"
      ? record.message
      : error;
  const rawCode = errorCode(record);
  const code = /^[A-Z0-9_]{2,20}$/.test(rawCode) ? rawCode : undefined;
  return {
    name: safeText(name).slice(0, 200),
    message: safeMessage(name, message),
    ...(code ? { code } : {}),
  };
}
