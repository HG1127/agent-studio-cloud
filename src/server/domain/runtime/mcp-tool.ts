import { McpToolInputDefinition, McpToolOutput, MAX_MCP_DEFINITION_BYTES, MAX_MCP_RESPONSE_BYTES } from "@/contracts/mcp-tool";
import { isPassiveJsonData } from "@/contracts/json";
import { canonicalJson } from "@/server/domain/canonical-json";
import { validateJsonObjectSchema, validateJsonSchemaDefinition } from "@/server/domain/json-schema";

export function mcpToolInputDefinitionIssue(definition: unknown): string | null {
  const error = "工具参数定义无效或超过容量，请检查服务端配置";
  if (!isPassiveJsonData(definition, MAX_MCP_DEFINITION_BYTES)) return error;
  const parsed = McpToolInputDefinition.safeParse(definition);
  return !parsed.success || parsed.data.type !== "object" || validateJsonSchemaDefinition(parsed.data) ? error : null;
}

export function mcpToolDefinitionIssue(actual: Record<string, unknown>, expected: Record<string, unknown>): string | null {
  if (mcpToolInputDefinitionIssue(actual) || mcpToolInputDefinitionIssue(expected)
    || canonicalJson(actual) !== canonicalJson(expected)) return "远端工具参数规则已变化，请核对并重新发布助手";
  return null;
}

export function mcpToolOutputDefinitionIssue(actual: unknown, expected: Record<string, unknown>): string | null {
  // 旧服务可不公布回执定义，实际回执仍须通过本地契约。
  if (actual === undefined) return null;
  const error = "远端工具回执规则已变化或无效，请核对并重新发布助手";
  if (!isPassiveJsonData(actual, MAX_MCP_RESPONSE_BYTES) || !isPassiveJsonData(expected, MAX_MCP_RESPONSE_BYTES)
    || !actual || typeof actual !== "object" || Array.isArray(actual)) return error;
  for (const definition of [actual, expected]) {
    if (new TextEncoder().encode(JSON.stringify(definition)).byteLength > MAX_MCP_RESPONSE_BYTES) return error;
  }
  const definition = actual as Record<string, unknown>;
  return definition.type !== "object" || validateJsonSchemaDefinition(definition)
    || validateJsonSchemaDefinition(expected) || canonicalJson(definition) !== canonicalJson(expected) ? error : null;
}

export function normalizeMcpToolResult(result: unknown, schema: Record<string, unknown>) {
  const failure = (error: string) => ({ ok: false as const, error, retryable: false });
  if (!isPassiveJsonData(result, MAX_MCP_RESPONSE_BYTES) || !result || typeof result !== "object" || Array.isArray(result)) {
    return failure("远端工具回执无效或超过容量限制");
  }
  const raw = result as Record<string, unknown>;
  if (raw.isError === true) return failure("远端工具报告操作未完成");
  let output: unknown = raw.structuredContent;
  if (output === undefined) {
    const content = raw.content;
    if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== "text" || typeof content[0]?.text !== "string") {
      return failure("远端工具必须返回结构化对象或单段对象格式文本");
    }
    try { output = JSON.parse(content[0].text); } catch { return failure("远端工具返回的不是有效对象格式文本"); }
  }
  const parsed = McpToolOutput.safeParse(output);
  if (!parsed.success) return failure("远端工具回执不是有效对象或超过容量限制");
  if (Object.hasOwn(parsed.data, "ok") && parsed.data.ok !== true) return failure("远端工具回执表明操作未完成");
  if (validateJsonObjectSchema(parsed.data, schema)) return failure("远端工具回执不符合字段契约");
  return { ok: true as const, output: parsed.data };
}
