export function hasMeaningfulResult(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulResult);
  if (typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (object.ok === false || object.status === "failed") return false;
  return Object.values(object).some(hasMeaningfulResult);
}
