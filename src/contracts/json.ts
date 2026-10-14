import { z } from "zod";

export const JsonStorageValue = z.json();
export type JsonStorageValue = z.infer<typeof JsonStorageValue>;

export const JsonStorageRecord = z.record(z.string(), JsonStorageValue);
export type JsonStorageRecord = z.infer<typeof JsonStorageRecord>;

export function isPlainJsonObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return true;
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  // Workflow 的参数来自另一虚拟环境，不能用本环境的 Object.prototype 身份判断。
  return Object.getPrototypeOf(prototype) === null
    && typeof constructor === "function"
    && constructor.prototype === prototype
    && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object);
}

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
      } else if (!isPlainJsonObject(item)) {
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

export function isPassiveJsonData(value: unknown, maxChars: number, maxDepth = 32, maxEntries = 50_000): boolean {
  const stack: Array<{ value: unknown; depth: number } | { leave: object }> = [{ value, depth: 0 }];
  const ancestors = new Set<object>();
  let entries = 0, chars = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if ("leave" in current) { ancestors.delete(current.leave); continue; }
    if (++entries > maxEntries || current.depth > maxDepth) return false;
    const item = current.value;
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "number") { if (!Number.isFinite(item)) return false; continue; }
    if (typeof item === "string") { chars += item.length; if (chars > maxChars) return false; continue; }
    if (!item || typeof item !== "object" || !Array.isArray(item) && !isPlainJsonObject(item) || ancestors.has(item)) return false;
    const keys = Reflect.ownKeys(item);
    if (keys.length > maxEntries + 1) return false;
    ancestors.add(item); stack.push({ leave: item });
    for (const key of keys) {
      if (typeof key !== "string") return false;
      if (Array.isArray(item) && key === "length") continue;
      if (Array.isArray(item) && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return false;
      chars += key.length;
      if (chars > maxChars || stack.length > maxEntries) return false;
      stack.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
  return true;
}
