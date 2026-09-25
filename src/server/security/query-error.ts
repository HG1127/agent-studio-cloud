import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

const SAFE_QUERY_MESSAGE = "暂时无法读取数据，请稍后重试";

export class SafeQueryError extends Error {
  constructor() {
    super(SAFE_QUERY_MESSAGE);
    this.name = "SafeQueryError";
  }
}

export function queryUnavailableResponse(): Response {
  return Response.json(
    { ok: false, error: SAFE_QUERY_MESSAGE },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

export async function withSafeQueryError<T>(
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error(`[query:${label}] 读取失败`, safeErrorForLog(error));
    throw new SafeQueryError();
  }
}
