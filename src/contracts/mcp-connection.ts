import { z } from "zod";
import { boundedJsonStorageValue, JsonStorageRecord } from "@/contracts/json";
import { McpToolInputDefinition, MAX_MCP_DIRECTORY_PAGES, MAX_MCP_DIRECTORY_PAGE_TOOLS, MAX_MCP_SESSION_BYTES } from "@/contracts/mcp-tool";

export const McpConnectionId = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const McpConnectionCheckInput = z.object({ connectionId: McpConnectionId }).strict();
export type McpConnectionCheckInput = z.infer<typeof McpConnectionCheckInput>;
export const McpPingResponse = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number().int()]), result: z.object({}).strict() }).strict();
export type McpPingResponse = z.infer<typeof McpPingResponse>;
export const McpConnectionStatus = z.enum(["available", "credentials-rejected", "protocol-error", "unavailable", "definition-changed", "not-found", "configuration-error"]);
export type McpConnectionStatus = z.infer<typeof McpConnectionStatus>;
export const McpConnectionView = z.object({ id: McpConnectionId, name: z.string().min(1).max(60) }).strict();
export type McpConnectionView = z.infer<typeof McpConnectionView>;
export const McpConnectionListResult = z.object({ connections: z.array(McpConnectionView).max(50) }).strict();
export type McpConnectionListResult = z.infer<typeof McpConnectionListResult>;
export const McpConnectionRequestError = z.object({ error: z.string() }).strict();
export type McpConnectionRequestError = z.infer<typeof McpConnectionRequestError>;
export const McpBindableTool = z.object({ registryToolId: McpConnectionId, name: z.string().min(1).max(60), status: z.enum(["available", "definition-changed", "missing"]) }).strict();
export type McpBindableTool = z.infer<typeof McpBindableTool>;
export const McpConnectionCheckResult = z.object({ status: McpConnectionStatus, message: z.string(), tools: z.array(McpBindableTool).max(50) }).strict();
export type McpConnectionCheckResult = z.infer<typeof McpConnectionCheckResult>;
const Definition = boundedJsonStorageValue(64 * 1024, "工具定义").pipe(JsonStorageRecord);
export const McpRemoteToolName = z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/);
// 仅服务端配置使用此契约，不得作为请求或响应结构。
export const McpConnectionRegistration = McpConnectionView.extend({
  workspaceId: z.string().uuid(),
  endpoint: z.string().url().refine((value) => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }),
  headers: z.record(z.string(), z.string().max(4000)).default({}),
  tools: z.array(z.object({ registryToolId: McpConnectionId, name: z.string().min(1).max(60), action: McpConnectionId, inputSchema: McpToolInputDefinition, outputSchema: Definition.optional() }).strict()).min(1).max(50),
}).strict();
export type McpConnectionRegistration = z.infer<typeof McpConnectionRegistration>;
export const McpToolDirectory = boundedJsonStorageValue(MAX_MCP_SESSION_BYTES, "工具目录").pipe(
  z.array(z.object({ name: McpRemoteToolName, inputSchema: JsonStorageRecord, outputSchema: JsonStorageRecord.optional() })).max(MAX_MCP_DIRECTORY_PAGES * MAX_MCP_DIRECTORY_PAGE_TOOLS),
);
export type McpToolDirectory = z.infer<typeof McpToolDirectory>;
