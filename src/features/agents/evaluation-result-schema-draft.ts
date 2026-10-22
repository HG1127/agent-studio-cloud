import { EvaluationResultSchema, MAX_EVALUATION_RESULT_SCHEMA_BYTES } from "@/contracts/evaluation";

export type ResultSchemaSource =
  | { kind: "missing" | "none" | "unknown" }
  | { kind: "object"; value: EvaluationResultSchema };

export type ResultSchemaEdit =
  | { kind: "keep"; text: string | null }
  | { kind: "replace"; text: string }
  | { kind: "clear" };

export type ResultSchemaSession = {
  generation: number;
  revision: number;
  source: ResultSchemaSource;
  edit: ResultSchemaEdit;
};

export type ResultSchemaChange = {
  generation: number;
  revision: number;
  operation: { kind: "begin" } | { kind: "cancel" } | { kind: "clear" } | { kind: "replace"; text: string };
};

export function resultSchemaSource(value: unknown, supplied: boolean): ResultSchemaSource {
  if (!supplied || value === undefined) return { kind: "missing" };
  if (value === null) return { kind: "none" };
  try {
    const parsed = EvaluationResultSchema.safeParse(value);
    return parsed.success ? { kind: "object", value: parsed.data } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

export function resultSchemaSession(generation: number, value?: unknown, supplied = false): ResultSchemaSession {
  return { generation, revision: 0, source: resultSchemaSource(value, supplied), edit: { kind: "keep", text: null } };
}

export function changeResultSchema(session: ResultSchemaSession, request: ResultSchemaChange): ResultSchemaSession | null {
  // 同批输入使用当前代次继续填写；清除和取消必须核对确认时的精确修订。
  if (request.generation !== session.generation || request.revision > session.revision
    || (request.operation.kind !== "replace" && request.revision !== session.revision)) return null;
  const operation = request.operation;
  const edit: ResultSchemaEdit = operation.kind === "begin"
    ? { kind: "keep", text: session.source.kind === "object" ? JSON.stringify(session.source.value, null, 2) : "" }
    : operation.kind === "cancel"
      ? { kind: "keep", text: null }
      : operation.kind === "clear"
        ? { kind: "clear" }
        : { kind: "replace", text: operation.text };
  return { ...session, revision: session.revision + 1, edit };
}

export function resultSchemaPayload(session: ResultSchemaSession):
  { ok: true; value: EvaluationResultSchema | null | undefined } | { ok: false; error: string } {
  if (session.edit.kind === "keep") return { ok: true, value: undefined };
  if (session.edit.kind === "clear") return { ok: true, value: null };
  const text = session.edit.text;
  if (new TextEncoder().encode(text).byteLength > MAX_EVALUATION_RESULT_SCHEMA_BYTES) {
    return { ok: false, error: "结果结构规则不能超过32KB，请缩小内容后再保存" };
  }
  try {
    const parsed = EvaluationResultSchema.safeParse(JSON.parse(text) as unknown);
    if (!parsed.success) return { ok: false, error: "结果结构规则须是合法对象，根类型必须是对象；请在开发者编辑区核对" };
    const unchanged = session.source.kind === "object" && JSON.stringify(parsed.data) === JSON.stringify(session.source.value);
    return { ok: true, value: unchanged ? undefined : parsed.data };
  } catch {
    return { ok: false, error: "结果结构规则的对象格式不完整，请在开发者编辑区核对；清除规则须明确确认" };
  }
}

export function resultSchemaCheckSummary(expectationCount: number, value: unknown, supplied: boolean): string {
  const source = resultSchemaSource(value, supplied);
  if (source.kind === "object") return expectationCount
    ? expectationCount + " 项字段检查，并检查结果结构"
    : "检查结果结构";
  if (source.kind === "unknown") return expectationCount
    ? expectationCount + " 项字段检查；结构规则暂时无法核对"
    : "结构规则暂时无法核对";
  if (expectationCount) return expectationCount + " 项结果检查";
  return source.kind === "missing" ? "未设置字段检查；结构规则信息未提供" : "只检查流程是否成功完成";
}
