import { z } from "zod";
import type { AgentInputField } from "@/contracts/manifest";
import { MAX_RUN_INPUT_BYTES, RunInputPayload } from "@/contracts/run";
import { webToolInputLabel } from "./web-tool-field-label";

const PreviewInputCheck = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), checkedFields: z.number().int().nonnegative() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type PreviewInputCheck = z.infer<typeof PreviewInputCheck>;

const PreviewInputInspection = z.object({
  checkedFields: z.number().int().nonnegative(),
  issues: z.array(z.object({ fieldIndex: z.number().int().nonnegative().nullable(), error: z.string() })),
});
export type PreviewInputInspection = z.infer<typeof PreviewInputInspection>;

const PreparedPreviewInput = PreviewInputInspection.extend({ input: RunInputPayload.nullable() });
export type PreparedPreviewInput = z.infer<typeof PreparedPreviewInput>;

function previewValues(fields: AgentInputField[], values: Record<string, string>) {
  let checkedFields = 0;
  const issues: PreviewInputInspection["issues"] = [];
  const entries: Array<[string, unknown]> = [];
  for (const [index, field] of fields.entries()) {
    const label = webToolInputLabel(field, index);
    const original = values[field.name] ?? "";
    const raw = original.trim();
    if (!raw) {
      if (field.required) issues.push({ fieldIndex: index, error: `请填写${label}` });
      continue;
    }
    let value: unknown = field.type === "string" ? original : raw;
    if (field.type === "number") {
      value = Number(raw);
      if (!Number.isFinite(value)) { issues.push({ fieldIndex: index, error: `${label}需要填写数字` }); continue; }
    }
    if (field.type === "boolean") {
      if (raw !== "true" && raw !== "false") { issues.push({ fieldIndex: index, error: `请为${label}选择是或否` }); continue; }
      value = raw === "true";
    }
    if (field.type === "object" || field.type === "array") {
      try { value = JSON.parse(raw) as unknown; } catch { issues.push({ fieldIndex: index, error: `${label}的结构格式不正确` }); continue; }
      if (field.type === "array" ? !Array.isArray(value) : value === null || typeof value !== "object" || Array.isArray(value)) {
        issues.push({ fieldIndex: index, error: `${label}的结构格式不正确` });
        continue;
      }
    }
    entries.push([field.name, value]);
    checkedFields += 1;
  }
  return { checkedFields, issues, candidate: Object.fromEntries(entries) };
}

function inputBytes(input: Record<string, unknown>): number | null {
  try { return new TextEncoder().encode(JSON.stringify(input)).byteLength; }
  catch { return null; }
}

export function previewInputCapacity(fields: AgentInputField[], values: Record<string, string>): number | null {
  const { issues, candidate } = previewValues(fields, values);
  return issues.length ? null : inputBytes(candidate);
}

export function preparePreviewInput(fields: AgentInputField[], values: Record<string, string>): PreparedPreviewInput {
  const { checkedFields, issues, candidate } = previewValues(fields, values);
  let input: PreparedPreviewInput["input"] = null;
  if (issues.length === 0) {
    const parsed = RunInputPayload.safeParse(candidate);
    if (!parsed.success) {
      const bytes = inputBytes(candidate);
      issues.push({ fieldIndex: null, error: bytes !== null && bytes > MAX_RUN_INPUT_BYTES
        ? "全部输入合计不能超过 " + MAX_RUN_INPUT_BYTES + " 字节；完整填写已保留，没有启动任务。"
        : parsed.error.issues[0]?.message ?? "填写内容无法按运行输入格式读取" });
    }
    else input = parsed.data;
  }
  return { checkedFields, issues, input };
}

export function inspectPreviewInput(fields: AgentInputField[], values: Record<string, string>): PreviewInputInspection {
  const { checkedFields, issues } = preparePreviewInput(fields, values);
  return { checkedFields, issues };
}

export function checkPreviewInput(fields: AgentInputField[], values: Record<string, string>): PreviewInputCheck {
  const { checkedFields, issues } = inspectPreviewInput(fields, values);
  if (issues[0]) return { ok: false, error: issues[0].error };
  return { ok: true, checkedFields };
}
