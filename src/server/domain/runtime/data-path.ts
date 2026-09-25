const RESERVED_DATA_PATH_SEGMENTS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

export function safeDataPathSegments(path: string): string[] | null {
  const segments = path.split(".").filter(Boolean);
  return segments.length > 0 && segments.every((segment) => !RESERVED_DATA_PATH_SEGMENTS.has(segment))
    ? segments
    : null;
}
