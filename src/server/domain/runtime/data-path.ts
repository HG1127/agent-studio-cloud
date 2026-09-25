const RESERVED_DATA_PATH_SEGMENTS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

export function isSafeDataPathSegment(segment: string): boolean {
  return Boolean(segment) && !RESERVED_DATA_PATH_SEGMENTS.has(segment);
}

export function safeDataPathSegments(path: string): string[] | null {
  const segments = path.split(".");
  return segments.length > 0 && segments.every(isSafeDataPathSegment)
    ? segments
    : null;
}
