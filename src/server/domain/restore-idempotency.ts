export function restorationMatchesSource(data: unknown, sourceVersionId: string): boolean {
  return Boolean(
    data
    && typeof data === "object"
    && !Array.isArray(data)
    && (data as Record<string, unknown>).sourceVersionId === sourceVersionId,
  );
}
