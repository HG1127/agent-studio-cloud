import { McpToolOutput, MAX_MCP_RESPONSE_BYTES } from "@/contracts/mcp-tool";
import { isPassiveJsonData } from "@/contracts/json";
import { canonicalJson } from "@/server/domain/canonical-json";
import { validateJsonObjectSchema, validateJsonSchemaDefinition } from "@/server/domain/json-schema";

export function mcpToolDefinitionIssue(actual: Record<string, unknown>, expected: Record<string, unknown>): string | null {
  if (!isPassiveJsonData(actual, 32 * 1024) || validateJsonSchemaDefinition(actual)
    || canonicalJson(actual) !== canonicalJson(expected)) return "远端工具参数规则已变化，请核对并重新发布助手";
  return null;
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
