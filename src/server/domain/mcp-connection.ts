import { z } from "zod";
import { McpConnectionRegistration, McpToolDirectory, type McpConnectionStatus, type McpConnectionCheckResult } from "@/contracts/mcp-connection";
import { toolDefinitionsEqual } from "@/server/domain/tool-definition-equality";
import { validateJsonSchemaDefinition } from "@/server/domain/json-schema";
import { isPassiveJsonData } from "@/contracts/json";
import { MAX_MCP_SESSION_BYTES } from "@/contracts/mcp-tool";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import { mcpToolDefinitionIssue, mcpToolInputDefinitionIssue, mcpToolLocalOutputDefinitionIssue, mcpToolOutputDefinitionIssue } from "@/server/domain/runtime/mcp-tool";
const forbiddenHeaders = new Set(["connection", "content-length", "host", "cookie", "set-cookie", "proxy-authorization", "proxy-authenticate", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"]);

type McpExecutionOutputDefinitions = ReadonlyMap<McpConnectionRegistration["tools"][number]["registryToolId"], ToolRegistryOption["outputSchema"]>;

export function mcpExecutionOutputDefinitionsAreValid(registration: McpConnectionRegistration, definitions?: McpExecutionOutputDefinitions): boolean {
  if (definitions === undefined) return true;
  if (definitions.size > registration.tools.length) return false;
  for (const [id, definition] of definitions) {
    const tool = registration.tools.find((tool) => tool.registryToolId === id);
    if (!tool || mcpToolLocalOutputDefinitionIssue(definition)
      || tool.outputSchema !== undefined && !toolDefinitionsEqual(tool.outputSchema, definition)) return false;
  }
  return true;
}

export function mcpHeadersAreValid(headers: McpConnectionRegistration["headers"]): boolean {
  const entries = Object.entries(headers), names = new Set<string>();
  if (entries.length > 20) return false;
  for (const [name, value] of entries) {
    const normalized = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== "string" || value.length > 4000
      || /[\r\n]/.test(value) || forbiddenHeaders.has(normalized) || names.has(normalized)) return false;
    names.add(normalized);
  }
  return true;
}

export function parseMcpConnections(raw: string | undefined): McpConnectionRegistration[] | null {
  if (!raw?.trim()) return [];
  if (new TextEncoder().encode(raw).byteLength > 1024 * 1024) return null;
  try {
    const registrations = z.array(McpConnectionRegistration).max(50).parse(JSON.parse(raw));
    const ids = new Set<string>(), toolIds = new Set<string>();
    for (const registration of registrations) {
      if (ids.has(registration.id)) return null;
      ids.add(registration.id);
      if (!mcpHeadersAreValid(registration.headers)) return null;
      const actions = new Set<string>();
      for (const tool of registration.tools) {
        if (toolIds.has(tool.registryToolId) || actions.has(tool.action) || mcpToolInputDefinitionIssue(tool.inputSchema)
          || tool.outputSchema && validateJsonSchemaDefinition(tool.outputSchema)) return null;
        toolIds.add(tool.registryToolId); actions.add(tool.action);
      }
    }
    return registrations;
  } catch { return null; }
}

export function mcpCheckFailure(status: McpConnectionStatus): McpConnectionCheckResult {
  const messages: Record<McpConnectionStatus, string> = {
    available: "连接及已登记工具的定义检查通过", "credentials-rejected": "连接拒绝访问，请管理员检查服务端凭据",
    "protocol-error": "连接返回的协议或目录无效", unavailable: "连接暂时不可用，请稍后重试",
    "definition-changed": "工具定义已变化，请管理员重新核对", "not-found": "未找到已登记的连接", "configuration-error": "连接配置无效，请管理员检查",
  };
  return { status, message: messages[status], tools: [] };
}

export function compareMcpDirectory(registration: McpConnectionRegistration, directory: unknown, executionOutputDefinitions?: McpExecutionOutputDefinitions): McpConnectionCheckResult {
  if (!mcpExecutionOutputDefinitionsAreValid(registration, executionOutputDefinitions)) return mcpCheckFailure("configuration-error");
  if (!isPassiveJsonData(directory, MAX_MCP_SESSION_BYTES)) return mcpCheckFailure("protocol-error");
  const parsed = McpToolDirectory.safeParse(directory);
  if (!parsed.success) return mcpCheckFailure("protocol-error");
  const byName = new Map(parsed.data.map((tool) => [tool.name, tool]));
  if (byName.size !== parsed.data.length) return mcpCheckFailure("protocol-error");
  const tools = registration.tools.map((expected) => {
    const actual = byName.get(expected.action);
    const status = !actual ? "missing" as const
      : mcpToolDefinitionIssue(actual.inputSchema, expected.inputSchema)
        || expected.outputSchema !== undefined && !toolDefinitionsEqual(actual.outputSchema ?? null, expected.outputSchema)
        || executionOutputDefinitions?.has(expected.registryToolId) && mcpToolOutputDefinitionIssue(actual.outputSchema, executionOutputDefinitions.get(expected.registryToolId)!)
        ? "definition-changed" as const : "available" as const;
    return { registryToolId: expected.registryToolId, name: expected.name, status };
  });
  const status = tools.every((tool) => tool.status === "available") ? "available" : "definition-changed";
  return { ...mcpCheckFailure(status), tools };
}
