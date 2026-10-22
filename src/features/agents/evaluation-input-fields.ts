import type { AgentInputField } from "@/contracts/manifest";

export function evaluationFieldLabel(field: AgentInputField, index: number): string {
  return field.label?.trim() || `业务信息 ${index + 1}`;
}

export function inputFitsFields(input: Record<string, unknown>, fields: AgentInputField[]): boolean {
  const byName = new Map(fields.map((field) => [field.name, field]));
  return Object.entries(input).every(([name, value]) => {
    const field = byName.get(name);
    if (!field) return false;
    if (field.type === "array") return Array.isArray(value);
    if (field.type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
    return typeof value === field.type;
  });
}

export function evaluationInputRows(input: Record<string, unknown>, fields?: AgentInputField[]) {
  const matchesCurrentVersion = Boolean(fields?.length && inputFitsFields(input, fields));
  const entries = matchesCurrentVersion && fields
    ? fields.flatMap((field, index) => Object.hasOwn(input, field.name) ? [{
      label: evaluationFieldLabel(field, index), value: input[field.name],
    }] : [])
    : Object.values(input).map((value, index) => ({ label: `业务信息 ${index + 1}`, value }));
  return { matchesCurrentVersion, entries };
}

export function evaluationInputSummary(input: Record<string, unknown>, fields?: AgentInputField[]): string {
  const { entries } = evaluationInputRows(input, fields);
  if (entries.length === 0) return "未填写运行输入";
  const shown = entries.slice(0, 2).map(({ label, value }) => {
    const text = Array.isArray(value) ? `列表 ${value.length} 项`
      : value !== null && typeof value === "object" ? "已填写内容"
        : typeof value === "boolean" ? value ? "是" : "否"
          : String(value ?? "未填写").replace(/\s+/g, " ");
    return `${label}：${text.length > 36 ? `${text.slice(0, 36)}…` : text}`;
  });
  return `${shown.join(" · ")}${entries.length > 2 ? ` · 另有 ${entries.length - 2} 项` : ""}`;
}

export function valuesFromEvaluationInput(input: Record<string, unknown>, fields: AgentInputField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => {
    const value = input[field.name];
    return [field.name, value === undefined ? "" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)];
  }));
}

export function parseEvaluationFieldValues(fields: AgentInputField[], values: Record<string, string>, checkRequired = true):
  { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  const input: Record<string, unknown> = {};
  for (const [index, field] of fields.entries()) {
    const raw = values[field.name] ?? "";
    const label = evaluationFieldLabel(field, index);
    if (!raw.trim()) {
      if (field.required && checkRequired) return { ok: false, error: `请填写${label}` };
      continue;
    }
    if (field.type === "number") {
      const value = Number(raw);
      if (!Number.isFinite(value)) return { ok: false, error: `${label}必须是数字` };
      input[field.name] = value;
    } else if (field.type === "boolean") {
      if (raw !== "true" && raw !== "false") return { ok: false, error: `请选择${label}` };
      input[field.name] = raw === "true";
    } else if (field.type === "object" || field.type === "array") {
      try {
        const value = JSON.parse(raw) as unknown;
        if (field.type === "array" ? !Array.isArray(value) : value === null || typeof value !== "object" || Array.isArray(value)) {
          return { ok: false, error: `${label}的格式不正确` };
        }
        input[field.name] = value;
      } catch {
        return { ok: false, error: `${label}的格式不正确` };
      }
    } else {
      input[field.name] = raw;
    }
  }
  return { ok: true, input };
}
