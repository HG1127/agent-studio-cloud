import { jsonValuesEqual } from "@/server/domain/json-value";
import { isSafeDataPathSegment } from "@/server/domain/runtime/data-path";

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function typeMatches(value: unknown, expected: unknown): boolean {
  const allowed = Array.isArray(expected) ? expected : [expected];
  return allowed.some((type) => {
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    if (type === "array") return Array.isArray(value);
    if (type === "null") return value === null;
    return typeof value === type;
  });
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  "$schema", "title", "description", "examples", "default",
  "type", "properties", "required", "items", "enum", "const",
  "minLength", "maxLength", "pattern",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minItems", "maxItems", "minProperties", "maxProperties", "additionalProperties",
]);
const MAX_SCHEMA_FIELDS = 100;
const MAX_SCHEMA_CHOICES = 100;
const MAX_PATTERN_LENGTH = 200;
const MAX_PATTERN_INPUT_LENGTH = 4096;
const MAX_VALUE_DEPTH = 32;
const MAX_VALUE_NODES = 50_000;

function jsonValueSafetyIssue(value: unknown): string | null {
  const stack: Array<{ value: unknown; path: string; depth: number }> = [{ value, path: "消息", depth: 0 }];
  const visited = new WeakSet<object>();
  let visitedNodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    visitedNodes += 1;
    if (visitedNodes > MAX_VALUE_NODES) return `消息内容不能超过 ${MAX_VALUE_NODES} 项`;
    if (current.depth > MAX_VALUE_DEPTH) return `${current.path}内容层级超过 ${MAX_VALUE_DEPTH} 层`;
    if (!current.value || typeof current.value !== "object") continue;
    if (visited.has(current.value)) continue;
    visited.add(current.value);
    if (Array.isArray(current.value)) {
      if (visitedNodes + stack.length + current.value.length > MAX_VALUE_NODES) {
        return `消息内容不能超过 ${MAX_VALUE_NODES} 项`;
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], path: `${current.path}[${index}]`, depth: current.depth + 1 });
      }
      continue;
    }
    const entries = Object.entries(current.value as Record<string, unknown>);
    if (visitedNodes + stack.length + entries.length > MAX_VALUE_NODES) {
      return `消息内容不能超过 ${MAX_VALUE_NODES} 项`;
    }
    for (const [key] of entries) {
      if (!isSafeDataPathSegment(key)) return `${current.path}不能使用保留字段名“${key}”`;
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      stack.push({ value: child, path: `${current.path}.${key}`, depth: current.depth + 1 });
    }
  }
  return null;
}

function nonnegativeIntegerRule(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function conflictingNumericBounds(rule: Record<string, unknown>): boolean {
  const lowers = [
    typeof rule.minimum === "number" ? { value: rule.minimum, exclusive: false } : null,
    typeof rule.exclusiveMinimum === "number" ? { value: rule.exclusiveMinimum, exclusive: true } : null,
  ].filter((bound): bound is { value: number; exclusive: boolean } => bound !== null);
  const uppers = [
    typeof rule.maximum === "number" ? { value: rule.maximum, exclusive: false } : null,
    typeof rule.exclusiveMaximum === "number" ? { value: rule.exclusiveMaximum, exclusive: true } : null,
  ].filter((bound): bound is { value: number; exclusive: boolean } => bound !== null);
  if (lowers.length === 0 || uppers.length === 0) return false;
  const lowerValue = Math.max(...lowers.map((bound) => bound.value));
  const upperValue = Math.min(...uppers.map((bound) => bound.value));
  if (lowerValue !== upperValue) return lowerValue > upperValue;
  return lowers.some((bound) => bound.value === lowerValue && bound.exclusive)
    || uppers.some((bound) => bound.value === upperValue && bound.exclusive);
}

function validateSchemaRule(schema: unknown, path: string, depth: number): string | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return `${path}必须是对象`;
  if (depth > 8) return `${path}字段结构层级超过 8 层`;
  const rule = schema as Record<string, unknown>;
  const unsupported = Object.keys(rule).find((key) => !SUPPORTED_SCHEMA_KEYS.has(key));
  if (unsupported) return `${path}使用了暂不支持的规则“${unsupported}”`;
  if (rule.type !== undefined) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    const allowed = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
    if (types.length === 0 || types.some((type) => typeof type !== "string" || !allowed.has(type))) {
      return `${path}的 type 不正确`;
    }
  }
  for (const key of ["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"] as const) {
    if (rule[key] !== undefined && !nonnegativeIntegerRule(rule[key])) return `${path}的 ${key} 必须是非负整数`;
  }
  for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const) {
    if (rule[key] !== undefined && (typeof rule[key] !== "number" || !Number.isFinite(rule[key]))) {
      return `${path}的 ${key} 必须是有限数字`;
    }
  }
  for (const [minimumKey, maximumKey] of [
    ["minLength", "maxLength"],
    ["minItems", "maxItems"],
    ["minProperties", "maxProperties"],
  ] as const) {
    if (typeof rule[minimumKey] === "number" && typeof rule[maximumKey] === "number" && rule[minimumKey] > rule[maximumKey]) {
      return `${path}的 ${minimumKey} 不能大于 ${maximumKey}`;
    }
  }
  if (conflictingNumericBounds(rule)) return `${path}的数值上下限相互冲突`;
  if (rule.pattern !== undefined) {
    if (typeof rule.pattern !== "string") return `${path}的 pattern 必须是文字`;
    if (rule.pattern.length > MAX_PATTERN_LENGTH) return `${path}的 pattern 不能超过 ${MAX_PATTERN_LENGTH} 个字符`;
    try { new RegExp(rule.pattern); } catch { return `${path}的 pattern 不是有效正则表达式`; }
    const unescaped = rule.pattern.replace(/\\./g, "");
    if (/[()|]/.test(unescaped) || /\\[1-9]/.test(rule.pattern)) {
      return `${path}的 pattern 只能使用简单文字、字符范围和数量规则`;
    }
    if (!nonnegativeIntegerRule(rule.maxLength) || rule.maxLength > MAX_PATTERN_INPUT_LENGTH) {
      return `${path}使用 pattern 时必须设置不超过 ${MAX_PATTERN_INPUT_LENGTH} 的 maxLength`;
    }
  }
  if (rule.required !== undefined) {
    if (!Array.isArray(rule.required) || rule.required.some((item) => typeof item !== "string")) return `${path}的 required 必须是字段名列表`;
    if (rule.required.length > MAX_SCHEMA_FIELDS) return `${path}的 required 不能超过 ${MAX_SCHEMA_FIELDS} 项`;
    if (new Set(rule.required).size !== rule.required.length) return `${path}的 required 不能包含重复字段`;
    const reserved = rule.required.find((item) => !isSafeDataPathSegment(item));
    if (reserved) return `${path}的 required 不能使用保留字段名“${reserved}”`;
  }
  if (rule.enum !== undefined) {
    if (!Array.isArray(rule.enum) || rule.enum.length === 0) return `${path}的 enum 不能为空`;
    if (rule.enum.length > MAX_SCHEMA_CHOICES) return `${path}的 enum 不能超过 ${MAX_SCHEMA_CHOICES} 项`;
    if ("const" in rule && !rule.enum.some((candidate) => jsonValuesEqual(candidate, rule.const))) {
      return `${path}的 const 必须是 enum 中允许的值`;
    }
  }
  if (rule.additionalProperties !== undefined && typeof rule.additionalProperties !== "boolean" && (!rule.additionalProperties || typeof rule.additionalProperties !== "object" || Array.isArray(rule.additionalProperties))) {
    return `${path}的 additionalProperties 必须是布尔值或字段规则`;
  }
  if (rule.items !== undefined) {
    const error = validateSchemaRule(rule.items, `${path}.items`, depth + 1);
    if (error) return error;
  }
  if (rule.additionalProperties && typeof rule.additionalProperties === "object") {
    const error = validateSchemaRule(rule.additionalProperties, `${path}.additionalProperties`, depth + 1);
    if (error) return error;
  }
  if (rule.properties !== undefined) {
    if (!rule.properties || typeof rule.properties !== "object" || Array.isArray(rule.properties)) return `${path}的 properties 必须是对象`;
    const entries = Object.entries(rule.properties as Record<string, unknown>);
    if (entries.length > MAX_SCHEMA_FIELDS) return `${path}的 properties 不能超过 ${MAX_SCHEMA_FIELDS} 个字段`;
    for (const [key, child] of entries) {
      if (!isSafeDataPathSegment(key)) return `${path}的 properties 不能使用保留字段名“${key}”`;
      const error = validateSchemaRule(child, `${path}.properties.${key}`, depth + 1);
      if (error) return error;
    }
  }
  if (rule.additionalProperties === false && Array.isArray(rule.required)) {
    const properties = rule.properties && typeof rule.properties === "object" && !Array.isArray(rule.properties)
      ? rule.properties as Record<string, unknown>
      : {};
    const undeclared = rule.required.find((key) => typeof key === "string" && !Object.prototype.hasOwnProperty.call(properties, key));
    if (undeclared) return `${path}要求了未声明字段“${undeclared}”`;
  }
  return null;
}

function validateValue(value: unknown, schema: unknown, path: string, depth: number): string | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  if (depth > 8) return `${path}字段结构层级超过 8 层`;
  const rule = schema as Record<string, unknown>;
  if (rule.type && !typeMatches(value, rule.type)) {
    return `${path}类型不正确（收到 ${valueType(value)}）`;
  }
  if (Array.isArray(rule.enum) && !rule.enum.some((candidate) => jsonValuesEqual(candidate, value))) {
    return `${path}不是允许的值`;
  }
  if ("const" in rule && !jsonValuesEqual(rule.const, value)) return `${path}不是约定的固定值`;
  if (typeof value === "string") {
    const length = Array.from(value).length;
    if (typeof rule.minLength === "number" && length < rule.minLength) return `${path}长度不能少于 ${rule.minLength} 个字符`;
    if (typeof rule.maxLength === "number" && length > rule.maxLength) return `${path}长度不能超过 ${rule.maxLength} 个字符`;
    if (typeof rule.pattern === "string" && !new RegExp(rule.pattern).test(value)) return `${path}格式不符合要求`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof rule.minimum === "number" && value < rule.minimum) return `${path}不能小于 ${rule.minimum}`;
    if (typeof rule.maximum === "number" && value > rule.maximum) return `${path}不能大于 ${rule.maximum}`;
    if (typeof rule.exclusiveMinimum === "number" && value <= rule.exclusiveMinimum) return `${path}必须大于 ${rule.exclusiveMinimum}`;
    if (typeof rule.exclusiveMaximum === "number" && value >= rule.exclusiveMaximum) return `${path}必须小于 ${rule.exclusiveMaximum}`;
  }
  if (Array.isArray(value)) {
    if (typeof rule.minItems === "number" && value.length < rule.minItems) return `${path}至少需要 ${rule.minItems} 项`;
    if (typeof rule.maxItems === "number" && value.length > rule.maxItems) return `${path}最多允许 ${rule.maxItems} 项`;
    if (rule.items) {
      for (let index = 0; index < value.length; index += 1) {
        const error = validateValue(value[index], rule.items, `${path}[${index}]`, depth + 1);
        if (error) return error;
      }
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object);
    const unsafeKey = keys.find((key) => !isSafeDataPathSegment(key));
    if (unsafeKey) return `${path}不能使用保留字段名“${unsafeKey}”`;
    if (typeof rule.minProperties === "number" && keys.length < rule.minProperties) return `${path}至少需要 ${rule.minProperties} 个字段`;
    if (typeof rule.maxProperties === "number" && keys.length > rule.maxProperties) return `${path}最多允许 ${rule.maxProperties} 个字段`;
    const required = Array.isArray(rule.required) ? rule.required.filter((item): item is string => typeof item === "string") : [];
    const missing = required.find((key) => !Object.prototype.hasOwnProperty.call(object, key));
    if (missing) return `${path}.${missing}为必填字段`;
    const properties = rule.properties;
    const declared = properties && typeof properties === "object" && !Array.isArray(properties)
      ? properties as Record<string, unknown>
      : {};
    if (Object.keys(declared).length > 0) {
      for (const [key, childSchema] of Object.entries(declared)) {
        if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
        const error = validateValue(object[key], childSchema, `${path}.${key}`, depth + 1);
        if (error) return error;
      }
    }
    for (const key of keys.filter((key) => !Object.prototype.hasOwnProperty.call(declared, key))) {
      if (rule.additionalProperties === false) return `${path}.${key}不是允许的字段`;
      if (rule.additionalProperties && typeof rule.additionalProperties === "object") {
        const error = validateValue(object[key], rule.additionalProperties, `${path}.${key}`, depth + 1);
        if (error) return error;
      }
    }
  }
  return null;
}

export function validateJsonSchemaDefinition(schema: Record<string, unknown>): string | null {
  return validateSchemaRule(schema, "消息契约", 0);
}

export function validateJsonObjectSchema(payload: Record<string, unknown>, schema: Record<string, unknown>): string | null {
  const unsafe = jsonValueSafetyIssue(payload);
  if (unsafe) return unsafe;
  const schemaError = validateJsonSchemaDefinition(schema);
  if (schemaError) return schemaError;
  return validateValue(payload, schema, "消息", 0);
}
