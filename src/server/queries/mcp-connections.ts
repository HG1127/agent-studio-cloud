import { type McpConnectionView, type McpConnectionCheckResult, type McpConnectionConfigurationResult } from "@/contracts/mcp-connection";
import type { ToolRegistryConfigurationStatus } from "@/contracts/tool-registry";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { parseMcpConnections, mcpCheckFailure } from "@/server/domain/mcp-connection";
import { buildMcpConnectionConfiguration } from "@/server/domain/mcp-configuration";
import { loadToolRegistrySnapshot } from "@/server/tools/tool-registry";
import { checkMcpConnection } from "@/server/tools/mcp-connection-check";

function registeredConnections(workspaceId: string) {
  if (workspaceId !== DEMO_WORKSPACE_ID) return { status: "not-configured" as ToolRegistryConfigurationStatus, connections: [] };
  const { registry, status } = loadToolRegistrySnapshot();
  // MVP 连接沿用执行注册表的工具标识，避免另建一份可漂移的地址与凭据。
  const connections = registry.filter((tool) => tool.protocol === "mcp-streamable-http").map((tool) => {
    const registrations = parseMcpConnections(JSON.stringify([{
      id: tool.id, name: tool.name, workspaceId: DEMO_WORKSPACE_ID, endpoint: tool.endpoint, headers: tool.headers,
      tools: [{ registryToolId: tool.id, name: tool.name, action: tool.action, inputSchema: tool.inputSchema }],
    }]));
    return { id: tool.id, name: tool.name, registration: registrations?.[0] ?? null };
  });
  return { status, connections };
}

export function listMcpConnections(workspaceId = DEMO_WORKSPACE_ID): McpConnectionView[] {
  return registeredConnections(workspaceId).connections.map(({ id, name }) => ({ id, name }));
}

export function getMcpConnectionConfiguration(workspaceId = DEMO_WORKSPACE_ID): McpConnectionConfigurationResult {
  const { status, connections } = registeredConnections(workspaceId);
  return buildMcpConnectionConfiguration(status, connections.map(({ id, name, registration }) => ({
    view: { id, name }, configured: registration !== null,
  })));
}

export async function inspectMcpConnection(connectionId: string, workspaceId = DEMO_WORKSPACE_ID): Promise<McpConnectionCheckResult> {
  const registrations = registeredConnections(workspaceId);
  if (registrations.status === "configuration-error") return mcpCheckFailure("configuration-error");
  const item = registrations.connections.find((connection) => connection.id === connectionId);
  if (!item) return mcpCheckFailure("not-found");
  if (!item.registration) return mcpCheckFailure("configuration-error");
  return checkMcpConnection(item.registration);
}
