import { McpToolInputDefinition, McpToolOutput, McpToolTextContent, McpToolTextOutput, MAX_MCP_DEFINITION_BYTES, MAX_MCP_RESPONSE_BYTES } from "@/contracts/mcp-tool";
import { isPassiveJsonData } from "@/contracts/json";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
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

export function mcpToolLocalOutputDefinitionIssue(definition: unknown): string | null {
  const error = "工具回执定义无效或超过容量，请检查服务端配置";
  if (!isPassiveJsonData(definition, MAX_MCP_RESPONSE_BYTES)) return error;
  const parsed = McpToolOutput.safeParse(definition);
  if (!parsed.success || validateJsonSchemaDefinition(parsed.data)) return error;
  const type = parsed.data.type;
  if (type !== undefined && !(Array.isArray(type) ? type.includes("object") : type === "object")) return error;
  return null;
}

export function mcpToolOutputDefinitionIssue(actual: unknown, expected: Record<string, unknown>): string | null {
  const error = "远端工具回执规则已变化或无效，请核对并重新发布助手";
  if (mcpToolLocalOutputDefinitionIssue(expected)) return error;
  // 旧服务可不公布回执定义，实际回执仍须通过本地契约。
  if (actual === undefined) return null;
  if (!isPassiveJsonData(actual, MAX_MCP_RESPONSE_BYTES) || !isPassiveJsonData(expected, MAX_MCP_RESPONSE_BYTES)
    || !actual || typeof actual !== "object" || Array.isArray(actual)) return error;
  for (const definition of [actual, expected]) {
    if (new TextEncoder().encode(JSON.stringify(definition)).byteLength > MAX_MCP_RESPONSE_BYTES) return error;
  }
  const definition = actual as Record<string, unknown>;
  return definition.type !== "object" || validateJsonSchemaDefinition(definition)
    || validateJsonSchemaDefinition(expected) || canonicalJson(definition) !== canonicalJson(expected) ? error : null;
}

export function normalizeMcpToolResult(result: unknown, schema: Record<string, unknown>, context?: {
  operationKind?: ToolRegistryOption["operationKind"]; hasOutputDefinition?: boolean;
}) {
  const failure = (error: string) => ({ ok: false as const, error, retryable: false });
  const definitionIssue = mcpToolLocalOutputDefinitionIssue(schema);
  if (definitionIssue) return failure(definitionIssue);
  if (!isPassiveJsonData(result, MAX_MCP_RESPONSE_BYTES) || !result || typeof result !== "object" || Array.isArray(result)) {
    return failure("远端工具回执无效或超过容量限制");
  }
  const raw = result as Record<string, unknown>;
  if (raw.isError === true) return failure("远端工具报告操作未完成");
  let output: unknown = raw.structuredContent;
  if (output === undefined) {
    const content = raw.content;
    const singleText = Array.isArray(content) && content.length === 1 && content[0]?.type === "text" && typeof content[0]?.text === "string";
    if (singleText) {
      try { output = JSON.parse(content[0].text); } catch { /* 普通文字只允许已登记的只读工具适配。 */ }
    }
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      // 已公布结构化回执或写操作不能借文本适配绕过其业务回执。
      if (context?.operationKind !== "read" || context.hasOutputDefinition) {
        return failure(singleText ? "远端工具返回的不是有效对象格式文本" : "远端工具必须返回结构化对象或单段对象格式文本");
      }
      const textContent = McpToolTextContent.safeParse(content);
      if (!textContent.success) return failure("只读工具仅支持有限的纯文本结果，请检查远端返回内容");
      const textOutput = McpToolTextOutput.safeParse({ text: textContent.data.map((block) => block.text).join("\n\n") });
      if (!textOutput.success) return failure("远端工具文本结果超过容量限制");
      output = textOutput.data;
    }
  }
  const parsed = McpToolOutput.safeParse(output);
  if (!parsed.success) return failure("远端工具回执不是有效对象或超过容量限制");
  if (Object.hasOwn(parsed.data, "ok") && parsed.data.ok !== true) return failure("远端工具回执表明操作未完成");
  if (validateJsonObjectSchema(parsed.data, schema)) return failure("远端工具回执不符合字段契约");
  return { ok: true as const, output: parsed.data };
}
