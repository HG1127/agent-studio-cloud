import type { AgentInputField } from "@/contracts/manifest";

function typeMatches(value: unknown, type: string): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "array") return Array.isArray(value);
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return true;
}

export function validateRunInput(input: Record<string, unknown>, fields: AgentInputField[]): string | null {
  for (const field of fields) {
    const value = input[field.name];
    const missing = !(field.name in input) || value === null || value === undefined || (typeof value === "string" && !value.trim());
    if (field.required && missing) return `运行输入“${field.label ?? field.name}”不能为空`;
    if (!missing && !typeMatches(value, field.type)) return `运行输入“${field.label ?? field.name}”的格式不正确`;
  }
  return null;
}
