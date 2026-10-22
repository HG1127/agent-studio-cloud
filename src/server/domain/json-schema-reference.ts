import { isPlainJsonObject } from "@/contracts/json";
import { isSafeDataPathSegment } from "@/server/domain/runtime/data-path";

export const MAX_LOCAL_SCHEMA_REFERENCE_LENGTH = 2048;
export const MAX_LOCAL_SCHEMA_REFERENCE_HOPS = 32;
const MAP_KEYWORDS = new Set(["$defs", "definitions", "properties"]);
const ARRAY_KEYWORDS = new Set(["allOf", "anyOf", "oneOf"]);
const SINGLE_KEYWORDS = new Set(["items", "additionalProperties", "not"]);
const MODERN_DIALECT = /^https?:\/\/json-schema\.org\/draft\/(?:2020-12|2019-09)\/schema#?$/;

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && isPlainJsonObject(value as object);
}

function ownValue(value: object, key: string): unknown {
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property?.enumerable && Object.hasOwn(property, "value") ? property.value : undefined;
}

export function schemaDialectSupportsLocalReferences(schema: Record<string, unknown>): boolean {
  const dialect = Object.getOwnPropertyDescriptor(schema, "$schema");
  return !dialect || Object.hasOwn(dialect, "value") && typeof dialect.value === "string" && MODERN_DIALECT.test(dialect.value);
}

export function resolveLocalSchemaReference(root: Record<string, unknown>, reference: unknown):
  | { ok: true; schema: Record<string, unknown> | boolean }
  | { ok: false } {
  if (!plainObject(root) || typeof reference !== "string" || !reference.startsWith("#") || reference.length > MAX_LOCAL_SCHEMA_REFERENCE_LENGTH) return { ok: false };
  if (!schemaDialectSupportsLocalReferences(root)) return { ok: false };
  let pointer: string;
  try { pointer = decodeURIComponent(reference.slice(1)); } catch { return { ok: false }; }
  if (pointer !== "" && !pointer.startsWith("/")) return { ok: false };
  const encoded = pointer === "" ? [] : pointer.slice(1).split("/");
  if (encoded.length > MAX_LOCAL_SCHEMA_REFERENCE_HOPS || encoded.some((part) => /~(?:[^01]|$)/.test(part))) return { ok: false };
  const segments = encoded.map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = root;
  for (let index = 0; index < segments.length;) {
    if (!plainObject(current) || !schemaDialectSupportsLocalReferences(current)) return { ok: false };
    const keyword = segments[index++];
    if (MAP_KEYWORDS.has(keyword)) {
      const name = segments[index++], collection = ownValue(current, keyword);
      if (!name || !isSafeDataPathSegment(name) || !plainObject(collection)) return { ok: false };
      current = ownValue(collection, name);
    } else if (ARRAY_KEYWORDS.has(keyword)) {
      const position = segments[index++], collection = ownValue(current, keyword);
      if (!position || !/^(?:0|[1-9]\d*)$/.test(position) || !Array.isArray(collection) || Number(position) >= collection.length) return { ok: false };
      current = ownValue(collection, position);
    } else if (SINGLE_KEYWORDS.has(keyword)) {
      current = ownValue(current, keyword);
    } else return { ok: false };
  }
  return typeof current === "boolean" || plainObject(current) && schemaDialectSupportsLocalReferences(current) ? { ok: true, schema: current } : { ok: false };
}
