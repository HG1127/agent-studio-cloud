import { WorkflowOutputPreviewFailure, WorkflowOutputPreviewInput, WorkflowOutputPreviewSuccess, type WorkflowOutputPreviewField, type WorkflowOutputPreviewResult } from "@/contracts/workflow-output-preview";
import { jsonValuesEqual } from "@/server/domain/json-value";
import { isCredentialFieldName, redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";
import { buildInlineOutputCatalog, selectWorkflowOutputReferences } from "./inline-output-references";
import { projectWorkflowResult, resolveWorkflowOutputValue, validateOutputContract, validateOutputFieldPaths } from "./output-contract";

export function resolveWorkflowOutputPreview(raw: unknown): WorkflowOutputPreviewResult {
  const failure = (code: WorkflowOutputPreviewFailure["code"], error: string, fields: WorkflowOutputPreviewField[] = []) =>
    WorkflowOutputPreviewFailure.parse({ ok: false, executed: false, scope: "final-delivery-fields", code, error, fields });
  const parsed = WorkflowOutputPreviewInput.safeParse(raw);
  if (!parsed.success) return failure("invalid_request", "交付试算配置或样例数据无效，请检查格式和容量");
  const { workflow, outputs } = parsed.data;
  const configuration = workflow.outputContract?.fields ?? [];
  if (!jsonValuesEqual(configuration, redactStructuredCredentialData(configuration)) || configuration.some((field) => field.sourcePath?.some(isCredentialFieldName))) {
    return failure("unsafe_data", "交付配置包含凭据或选择了凭据字段，请只选择业务成果");
  }
  if (validateOutputFieldPaths(configuration)) return failure("invalid_request", "最终交付字段位置无效、重复或相互冲突，请检查配置");
  if (validateOutputContract(configuration, workflow.nodes)) return failure("invalid_source", "最终交付必须选择流程中有效的业务步骤，包括合法内部步骤");
  const references = selectWorkflowOutputReferences(buildInlineOutputCatalog(workflow), configuration);
  const fields: WorkflowOutputPreviewField[] = configuration.map((field) => {
    const selected = resolveWorkflowOutputValue(outputs, field, references);
    return { path: field.path, status: selected.status === "missing" && !field.required ? "omitted" : selected.status };
  });
  if (fields.some((field) => field.status === "invalid")) return failure("invalid_result", "选中的交付成果无效或超过运行容量限制", fields);
  if (fields.some((field) => field.status === "missing")) return failure("missing_source", "交付试算缺少必填成果，请补充样例或核对来源是否完成", fields);
  const projected = projectWorkflowResult(outputs, configuration, references);
  if (!projected.ok) return failure("invalid_result", "组合后的交付成果无效或超过运行容量限制", fields);
  if (!jsonValuesEqual(projected.result, redactStructuredCredentialData(projected.result))) {
    return failure("unsafe_data", "交付试算结果包含凭据，不能展示，请只选择业务字段", fields);
  }
  const result = WorkflowOutputPreviewSuccess.safeParse({
    ok: true, executed: false, scope: "final-delivery-fields",
    result: JSON.parse(JSON.stringify(projected.result)), fields,
  });
  return result.success ? result.data : failure("invalid_result", "交付试算响应超过展示容量限制", fields);
}
