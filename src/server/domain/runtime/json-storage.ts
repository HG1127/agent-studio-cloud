import { JsonStorageValue } from "@/contracts/json";
export { MAX_RUN_RESULT_BYTES } from "@/contracts/run";

export const MAX_STEP_OUTPUT_BYTES = 1024 * 1024;
export const MAX_RUN_STEP_OUTPUT_TOTAL_BYTES = 4 * 1024 * 1024;
export const MAX_RUN_CONTEXT_BYTES = 4 * 1024 * 1024;

export function jsonStorageIssue(value: unknown, maxBytes: number, label: string): string | null {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return `${label}必须是可保存的 JSON 数据`;
    if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
      const limit = maxBytes % (1024 * 1024) === 0
        ? `${maxBytes / (1024 * 1024)}MB`
        : `${Math.ceil(maxBytes / 1024)}KB`;
      return `${label}不能超过 ${limit}`;
    }
    if (!JsonStorageValue.safeParse(value).success) {
      return `${label}必须是可保存的 JSON 数据`;
    }
    return null;
  } catch {
    return `${label}必须是可保存的 JSON 数据`;
  }
}
