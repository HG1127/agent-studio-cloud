import { jsonValuesEqual } from "@/server/domain/json-value";

export function isDuplicatePublishedVersion(
  latest: { status: string; manifest: unknown } | null | undefined,
  release: "candidate" | "production",
  manifest: unknown,
): boolean {
  return Boolean(latest && latest.status === release && jsonValuesEqual(latest.manifest, manifest));
}
