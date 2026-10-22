import type { AgentInputField } from "@/contracts/manifest";
import { RunInputPayload } from "@/contracts/run";

export function runLauncherFieldLabel(field: AgentInputField, index: number): string {
  return field.label?.trim() || `业务信息 ${index + 1}`;
}

export function prepareRunLauncherInput(inputFields: AgentInputField[] | undefined, fieldValues: Record<string, string>, inputText: string):
  { input: RunInputPayload; error: null } | { input: null; error: string } {
  let input: unknown;
  if (inputFields?.length) {
    const values: Record<string, unknown> = Object.create(null);
    for (const [index, field] of inputFields.entries()) {
      const raw = fieldValues[field.name] ?? "";
      const label = runLauncherFieldLabel(field, index);
      if (!raw.trim()) {
        if (field.required) return { input: null, error: `请填写${label}` };
        continue;
      }
      if (field.type === "number") {
        const value = Number(raw);
        if (!Number.isFinite(value)) return { input: null, error: `${label}必须是数字` };
        values[field.name] = value;
      } else if (field.type === "boolean") {
        if (raw !== "true" && raw !== "false") return { input: null, error: `请为${label}选择是或否` };
        values[field.name] = raw === "true";
      } else if (field.type === "object" || field.type === "array") {
        try {
          const value: unknown = JSON.parse(raw);
          if (field.type === "array" ? !Array.isArray(value) : !value || typeof value !== "object" || Array.isArray(value)) throw new Error();
          values[field.name] = value;
        } catch {
          return { input: null, error: `${label}的格式不正确` };
        }
      } else values[field.name] = raw;
    }
    input = values;
  } else {
    try { input = JSON.parse(inputText) as unknown; }
    catch { return { input: null, error: "请输入正确的 JSON 格式" }; }
  }
  const parsed = RunInputPayload.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { input: null, error: issue?.code === "custom" ? issue.message : "请输入正确的 JSON 格式" };
  }
  return { input: parsed.data, error: null };
}
