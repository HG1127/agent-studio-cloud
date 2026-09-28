import type { AgentInputField } from "@/contracts/manifest";

export type PreviewInputCheck = { ok: true; checkedFields: number } | { ok: false; error: string };

export function checkPreviewInput(fields: AgentInputField[], values: Record<string, string>): PreviewInputCheck {
  let checkedFields = 0;
  for (const [index, field] of fields.entries()) {
    const label = field.label?.trim() || `业务信息 ${index + 1}`;
    const raw = values[field.name]?.trim() ?? "";
    if (!raw) {
      if (field.required) return { ok: false, error: `请填写${label}` };
      continue;
    }
    if (field.type === "number" && !Number.isFinite(Number(raw))) return { ok: false, error: `${label}需要填写数字` };
    if (field.type === "boolean" && raw !== "true" && raw !== "false") return { ok: false, error: `请为${label}选择是或否` };
    if (field.type === "object" || field.type === "array") {
      let value: unknown;
      try { value = JSON.parse(raw) as unknown; } catch { return { ok: false, error: `${label}的结构格式不正确` }; }
      if (field.type === "array" ? !Array.isArray(value) : value === null || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: `${label}的结构格式不正确` };
      }
    }
    checkedFields += 1;
  }
  return { ok: true, checkedFields };
}
