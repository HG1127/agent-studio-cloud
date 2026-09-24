function nonnegativeInteger(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export function resolveSseCursor(requestUrl: string, lastEventId: string | null): number {
  const queryCursor = nonnegativeInteger(new URL(requestUrl).searchParams.get("after"));
  const reconnectCursor = nonnegativeInteger(lastEventId);
  return Math.max(queryCursor, reconnectCursor);
}
