import type { ZodType } from "zod";

export function parseQueryRows<T>(label: string, schema: ZodType<T>, rows: unknown[]): T[] {
  const values: T[] = [];
  let invalidCount = 0;
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) values.push(parsed.data);
    else invalidCount += 1;
  }
  if (invalidCount > 0) {
    console.warn(`[query] 已忽略 ${invalidCount} 条不符合${label}契约的历史记录`);
  }
  return values;
}
