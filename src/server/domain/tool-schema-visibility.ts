import { isPassiveJsonData } from "@/contracts/json";
import { validateJsonSchemaDefinition } from "@/server/domain/json-schema";
import { isCredentialFieldName, redactCredentialText } from "@/server/domain/security/redact-sensitive";

function isToolCredentialFieldName(name: string): boolean {
  const field = name.replace(/tokeniz(?:er|ation|e|ing)/gi, "");
  if (/^token[_-]?(?:units?|usage|counts?|limits?|budgets?)$/i.test(field)) return false;
  return isCredentialFieldName(field);
}

function containsCredentialLiteral(value: unknown, credentialField: boolean): boolean {
  const pending = [{ value, credentialField }];
  while (pending.length) {
    const current = pending.pop()!;
    if (typeof current.value === "string") {
      if (current.credentialField && current.value.length > 0 || redactCredentialText(current.value) !== current.value) return true;
    } else if (Array.isArray(current.value)) {
      for (const item of current.value) pending.push({ value: item, credentialField: current.credentialField });
    } else if (current.value && typeof current.value === "object") {
      for (const [key, item] of Object.entries(current.value)) {
        if (redactCredentialText(key) !== key) return true;
        pending.push({ value: item, credentialField: current.credentialField || isToolCredentialFieldName(key) });
      }
    }
  }
  return false;
}

export function isToolSchemaSafeToExpose(schema: Record<string, unknown>): boolean {
  if (!isPassiveJsonData(schema, Number.MAX_SAFE_INTEGER) || validateJsonSchemaDefinition(schema)) return false;
  const pending = [{ schema, credentialField: false }];
  while (pending.length) {
    const current = pending.pop()!;
    for (const [key, value] of Object.entries(current.schema)) {
      if (key === "properties") {
        for (const [field, child] of Object.entries(value as Record<string, Record<string, unknown>>)) {
          if (redactCredentialText(field) !== field) return false;
          pending.push({ schema: child, credentialField: current.credentialField || isToolCredentialFieldName(field) });
        }
      } else if ((key === "items" || key === "additionalProperties") && value && typeof value === "object") {
        pending.push({ schema: value as Record<string, unknown>, credentialField: current.credentialField });
      } else {
        // 字段声明不是凭据值；固定值和示例才继承该字段的凭据性质。
        const literal = ["default", "const", "enum", "examples"].includes(key);
        if (containsCredentialLiteral(value, literal && current.credentialField)) return false;
      }
    }
  }
  return true;
}
