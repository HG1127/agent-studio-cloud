import { McpConnectionConfigurationResult, type McpConnectionView } from "@/contracts/mcp-connection";
import type { ToolRegistryConfigurationStatus } from "@/contracts/tool-registry";

export function buildMcpConnectionConfiguration(
  registryStatus: ToolRegistryConfigurationStatus,
  candidates: Array<{ view: McpConnectionView; configured: boolean }>,
): McpConnectionConfigurationResult {
  if (registryStatus === "configuration-error") {
    return McpConnectionConfigurationResult.parse({ status: "configuration-error", message: "工具登记配置无效，请核对服务端配置", connections: [] });
  }
  if (registryStatus === "not-configured" || candidates.length === 0) {
    return McpConnectionConfigurationResult.parse({ status: "not-configured", message: "尚未登记连接", connections: [] });
  }
  const connections = candidates.map(({ view, configured }) => ({
    id: view.id,
    name: view.name,
    status: configured ? "configured" as const : "configuration-error" as const,
    message: configured ? "配置检查通过，尚未检查远端服务" : "连接配置无效，请核对服务端配置",
  }));
  const configured = candidates.filter((candidate) => candidate.configured).length;
  return McpConnectionConfigurationResult.parse({
    status: configured === candidates.length ? "configured" : configured === 0 ? "configuration-error" : "partially-configured",
    message: configured === candidates.length ? "连接配置检查通过，尚未检查远端服务" : "连接配置需要核对，请查看各项配置状态",
    connections,
  });
}
