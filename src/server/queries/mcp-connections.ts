import { type McpConnectionView, type McpConnectionCheckResult } from "@/contracts/mcp-connection";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { parseMcpConnections, mcpCheckFailure } from "@/server/domain/mcp-connection";
import { loadToolRegistry } from "@/server/tools/tool-registry";
import { checkMcpConnection } from "@/server/tools/mcp-connection-check";

function registeredConnections(workspaceId: string) {
  if (workspaceId !== DEMO_WORKSPACE_ID) return [];
  const registry = loadToolRegistry();
  if (process.env.TOOL_REGISTRY_JSON?.trim() && registry.length === 0) return null;
  // MVP 连接沿用执行注册表的工具标识，避免另建一份可漂移的地址与凭据。
  return registry.filter((tool) => tool.protocol === "mcp-streamable-http").map((tool) => {
    const registrations = parseMcpConnections(JSON.stringify([{
      id: tool.id, name: tool.name, workspaceId: DEMO_WORKSPACE_ID, endpoint: tool.endpoint, headers: tool.headers,
      tools: [{ registryToolId: tool.id, name: tool.name, action: tool.action, inputSchema: tool.inputSchema }],
    }]));
    return { id: tool.id, name: tool.name, registration: registrations?.[0] ?? null };
  });
}

export function listMcpConnections(workspaceId = DEMO_WORKSPACE_ID): McpConnectionView[] {
  return (registeredConnections(workspaceId) ?? []).map(({ id, name }) => ({ id, name }));
}

export async function inspectMcpConnection(connectionId: string, workspaceId = DEMO_WORKSPACE_ID): Promise<McpConnectionCheckResult> {
  const registrations = registeredConnections(workspaceId);
  if (!registrations) return mcpCheckFailure("configuration-error");
  const item = registrations.find((connection) => connection.id === connectionId);
  if (!item) return mcpCheckFailure("not-found");
  if (!item.registration) return mcpCheckFailure("configuration-error");
  return checkMcpConnection(item.registration);
}
