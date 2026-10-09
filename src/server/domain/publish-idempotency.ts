import { jsonValuesEqual } from "@/server/domain/json-value";

export function isDuplicatePublishedVersion(
  latest: { status: string; manifest: unknown } | null | undefined,
  release: "candidate" | "production",
  manifest: unknown,
): boolean {
  if (!latest || latest.status !== release) return false;
  try {
    // JSONB 会丢弃对象的 undefined 字段，比较须使用同一持久表示。
    return jsonValuesEqual(latest.manifest, JSON.parse(JSON.stringify(manifest)));
  } catch { return false; }
}
