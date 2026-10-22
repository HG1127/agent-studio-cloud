import { z } from "zod";
import { AgentTargetOption } from "@/contracts/agent";
import type { ToolRegistryOption } from "@/contracts/tool-registry";

export const McpToolUseFilter = z.object({
  query: z.string().max(200),
  risk: z.enum(["all", "low", "medium", "high"]),
  operation: z.enum(["all", "read", "action", "undeclared"]),
}).strict();
export type McpToolUseFilter = z.infer<typeof McpToolUseFilter>;

export function filterMcpRegisteredTools(tools: readonly ToolRegistryOption[], filter: McpToolUseFilter) {
  const query = filter.query.trim().toLowerCase();
  return tools.filter((tool) => tool.protocol === "mcp-streamable-http"
    && (filter.risk === "all" || tool.risk === filter.risk)
    && (filter.operation === "all" || (filter.operation === "undeclared" ? tool.operationKind === undefined : tool.operationKind === filter.operation))
    && (!query || (tool.name + " " + tool.description).toLowerCase().includes(query)));
}

export function mcpToolUseAgentHref(agentId: unknown): string | null {
  const parsed = AgentTargetOption.shape.agentId.safeParse(agentId);
  return parsed.success ? "/agents/" + parsed.data + "#workflow" : null;
}
