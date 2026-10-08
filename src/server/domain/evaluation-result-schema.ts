import { EvaluationResultSchema } from "@/contracts/evaluation";
import { validateJsonSchemaDefinition } from "@/server/domain/json-schema";
import { jsonValuesEqual } from "@/server/domain/json-value";
import { redactCredentialText, redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";

export function evaluationResultSchemaIssue(schema: unknown): string | null {
  if (schema === undefined || schema === null) return null;
  const parsed = EvaluationResultSchema.safeParse(schema);
  if (!parsed.success) return "验收结果字段规则不完整或超出限制";
  const invalid = validateJsonSchemaDefinition(parsed.data);
  if (invalid) return redactCredentialText(invalid).replace(/^消息契约/, "验收结果字段规则").slice(0, 1_000);
  const stack: unknown[] = [parsed.data];
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === "string") {
      if (redactCredentialText(value) !== value) return "验收结果字段规则不能包含凭据，请移除后重试";
    } else if (Array.isArray(value)) stack.push(...value);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (["const", "enum", "default", "examples"].includes(key)
          && !jsonValuesEqual(child, redactStructuredCredentialData(child))) {
          return "验收结果字段规则不能包含凭据，请移除后重试";
        }
        stack.push(key, child);
      }
    }
  }
  return null;
}
