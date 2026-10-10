import { isPassiveJsonData, isPlainJsonObject, JsonStorageValue } from "@/contracts/json";
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

export function stepOutputStorageIssue(value: unknown, nodeType: string, label: string): string | null {
  const issue = jsonStorageIssue(value, MAX_STEP_OUTPUT_BYTES, label);
  if (issue !== `${label}不能超过 1MB` || nodeType !== "tool" || typeof value !== "object" || value === null) return issue;
  try {
    if (Array.isArray(value) || !isPlainJsonObject(value)) return issue;
    const successFlag = Object.getOwnPropertyDescriptor(value, "ok");
    if (!successFlag?.enumerable || successFlag.value !== true) return issue;
    const byteBudget = MAX_STEP_OUTPUT_BYTES + 10;
    // 被动检查计入数组索引字符，JSON不保存索引名；按条目上限额外容纳其位数。
    const passiveCharBudget = byteBudget * (String(byteBudget).length + 1);
    if (!isPassiveJsonData(value, passiveCharBudget, Infinity, byteBudget)) return issue;
    // 合法回执可能已占满业务预算，固定的成功标记不能再挤占这份容量。
    return jsonStorageIssue(value, byteBudget, label) ? issue : null;
  } catch {
    return issue;
  }
}
