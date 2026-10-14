import {
  McpConnectionCheckInput,
  McpConnectionCheckResult,
  McpConnectionListResult,
  type McpConnectionView,
} from "@/contracts/mcp-connection";

export async function readRegisteredConnections(signal: AbortSignal): Promise<McpConnectionView[]> {
  const response = await fetch("/api/mcp/connections", { cache: "no-store", credentials: "same-origin", signal });
  if (!response.ok) throw new Error("连接目录暂时无法读取，请重试。");
  const result = McpConnectionListResult.safeParse(await response.json());
  if (!result.success) throw new Error("连接目录返回的信息不完整，请重试。");
  return result.data.connections;
}

export async function checkRegisteredConnection(connectionId: McpConnectionView["id"], signal: AbortSignal): Promise<McpConnectionCheckResult> {
  const input = McpConnectionCheckInput.parse({ connectionId });
  const response = await fetch("/api/mcp/connections/check", {
    method: "POST", cache: "no-store", credentials: "same-origin", signal,
    headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
  if (!response.ok && response.status !== 404) throw new Error("本次检查没有取得有效结果，请重试。");
  const result = McpConnectionCheckResult.safeParse(await response.json());
  if (!result.success || response.status === 404 && result.data.status !== "not-found") {
    throw new Error("本次检查没有取得有效结果，请重试。");
  }
  return result.data;
}
