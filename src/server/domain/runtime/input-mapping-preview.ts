import { InputMappingPreviewFailure, InputMappingPreviewInput, InputMappingPreviewSuccess, type InputMappingPreviewField, type InputMappingPreviewResult } from "@/contracts/input-mapping-preview";
import { jsonValuesEqual } from "@/server/domain/json-value";
import { redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";
import { resolveInputValue, resolveNodeInput } from "./input-mapping";

export function resolveInputMappingPreview(raw: unknown): InputMappingPreviewResult {
  const failure = (code: InputMappingPreviewFailure["code"], error: string, fields: InputMappingPreviewField[] = []) =>
    InputMappingPreviewFailure.parse({ ok: false, executed: false, scope: "field-mapping", code, error, fields });
  const parsed = InputMappingPreviewInput.safeParse(raw);
  if (!parsed.success) return failure("invalid_request", "字段试算配置或样例数据无效，请检查格式和容量");
  const { mapping, input, outputs } = parsed.data;
  if (!jsonValuesEqual(mapping, redactStructuredCredentialData(mapping))) {
    return failure("unsafe_data", "字段试算配置包含凭据，请移除后重试");
  }
  const fields: InputMappingPreviewField[] = mapping.fields.map((binding) => ({
    target: [...binding.target],
    status: resolveInputValue(binding.source, input, outputs) !== undefined ? "provided"
      : binding.fallback !== undefined ? "fallback" : binding.required ? "missing" : "omitted",
  }));
  const resolved = resolveNodeInput({ node: { title: "字段试算", inputMapping: mapping }, input, outputs });
  if (!resolved.ok) return fields.some((field) => field.status === "missing")
    ? failure("missing_source", "字段试算缺少必填来源，请补充样例数据或明确兜底", fields)
    : failure("invalid_mapping_data", "映射后的输入无法保存或超过运行输入限制", fields);
  if (!jsonValuesEqual(resolved, redactStructuredCredentialData(resolved))) {
    return failure("unsafe_data", "试算结果包含凭据，不能展示，请只选择业务字段", fields);
  }
  const result = InputMappingPreviewSuccess.safeParse({
    ok: true, executed: false, scope: "field-mapping",
    ...JSON.parse(JSON.stringify(resolved)), includesUpstreamOutputs: mapping.includeUpstreamOutputs, fields,
  });
  return result.success ? result.data : failure("invalid_mapping_data", "字段试算结果超过限制", fields);
}
