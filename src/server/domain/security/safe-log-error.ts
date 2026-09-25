import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

const MAX_LOG_FIELD_CHARS = 2_000;

function safeText(value: unknown): string {
  return redactSensitiveText(String(value ?? "未知错误")).slice(0, MAX_LOG_FIELD_CHARS);
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
  const rawCode = typeof record?.code === "string" || typeof record?.code === "number"
    ? String(record.code)
    : "";
  const code = /^[A-Z0-9_]{2,20}$/.test(rawCode) ? rawCode : undefined;
  return {
    name: safeText(name).slice(0, 200),
    message: safeText(message),
    ...(code ? { code } : {}),
  };
}
