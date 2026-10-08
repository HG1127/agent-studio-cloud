import { z } from "zod";

export const JsonStorageValue = z.json();
export type JsonStorageValue = z.infer<typeof JsonStorageValue>;

export const JsonStorageRecord = z.record(z.string(), JsonStorageValue);
export type JsonStorageRecord = z.infer<typeof JsonStorageRecord>;

export function boundedJsonStorageValue(maxBytes: number, label: string) {
  return z.preprocess((value, context) => {
    const stack = [{ value, depth: 0 }];
    let entries = 0;
    let minimumChars = 0;
    let issue: string | null = null;
    while (stack.length && !issue) {
      const current = stack.pop()!;
      entries += 1;
      if (entries + stack.length > 50_000 || current.depth > 32) {
        issue = `${label}的内容或嵌套层级超过限制`;
        break;
      }
      const item = current.value;
      if (typeof item === "string") minimumChars += item.length;
      else if (item === null || typeof item === "boolean") continue;
      else if (typeof item === "number" && Number.isFinite(item)) continue;
      else if (typeof item !== "object" || !item) issue = `${label}必须是可保存的 JSON 数据`;
      else if (Array.isArray(item)) {
        if (entries + stack.length + item.length > 50_000) issue = `${label}的内容超过限制`;
        else for (const child of item) stack.push({ value: child, depth: current.depth + 1 });
      } else if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
        issue = `${label}只能包含普通对象和数组`;
      } else {
        const children = Object.entries(item);
        if (entries + stack.length + children.length > 50_000) issue = `${label}的内容超过限制`;
        else for (const [key, child] of children) {
          if (["__proto__", "prototype", "constructor"].includes(key)) {
            issue = `${label}不能使用保留字段名`;
            break;
          }
          minimumChars += key.length;
          stack.push({ value: child, depth: current.depth + 1 });
        }
      }
      if (minimumChars > maxBytes) issue = `${label}不能超过 ${maxBytes / 1024}KB`;
    }
    if (!issue && new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) {
      issue = `${label}不能超过 ${maxBytes / 1024}KB`;
    }
    if (issue) context.addIssue({ code: "custom", message: issue });
    return issue ? z.NEVER : value;
  }, JsonStorageValue);
}
