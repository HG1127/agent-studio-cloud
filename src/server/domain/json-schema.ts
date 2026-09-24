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

function validateValue(value: unknown, schema: unknown, path: string, depth: number): string | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  if (depth > 8) return `${path}字段结构层级超过 8 层`;
  const rule = schema as Record<string, unknown>;
  if (rule.type && !typeMatches(value, rule.type)) {
    return `${path}类型不正确（收到 ${valueType(value)}）`;
  }
  if (Array.isArray(rule.enum) && !rule.enum.some((candidate) => Object.is(candidate, value))) {
    return `${path}不是允许的值`;
  }
  if (Array.isArray(value) && rule.items) {
    for (let index = 0; index < value.length; index += 1) {
      const error = validateValue(value[index], rule.items, `${path}[${index}]`, depth + 1);
      if (error) return error;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const required = Array.isArray(rule.required) ? rule.required.filter((item): item is string => typeof item === "string") : [];
    const missing = required.find((key) => !(key in object));
    if (missing) return `${path}.${missing}为必填字段`;
    const properties = rule.properties;
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (!(key in object)) continue;
        const error = validateValue(object[key], childSchema, `${path}.${key}`, depth + 1);
        if (error) return error;
      }
    }
  }
  return null;
}

export function validateJsonObjectSchema(payload: Record<string, unknown>, schema: Record<string, unknown>): string | null {
  return validateValue(payload, schema, "消息", 0);
}
