import { z } from "zod";
import { boundedJsonStorageValue, JsonStorageRecord } from "./json";

export const McpRemoteToolName = z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/);
export type McpRemoteToolName = z.infer<typeof McpRemoteToolName>;

export const MAX_MCP_ARGUMENT_BYTES = 512 * 1024;
export const MAX_MCP_RESPONSE_BYTES = 1024 * 1024;
export const MAX_MCP_DEFINITION_BYTES = 32 * 1024;
export const MAX_MCP_SESSION_BYTES = 4 * MAX_MCP_RESPONSE_BYTES;
export const MAX_MCP_DIRECTORY_PAGES = 5;
export const MAX_MCP_DIRECTORY_PAGE_TOOLS = 100;
export const McpToolInputDefinition = boundedJsonStorageValue(MAX_MCP_DEFINITION_BYTES, "工具参数定义").pipe(JsonStorageRecord);
export type McpToolInputDefinition = z.infer<typeof McpToolInputDefinition>;
export const McpToolArguments = boundedJsonStorageValue(MAX_MCP_ARGUMENT_BYTES, "工具参数").pipe(JsonStorageRecord);
export const McpToolOutput = boundedJsonStorageValue(MAX_MCP_RESPONSE_BYTES, "工具回执").pipe(JsonStorageRecord);
export type McpToolArguments = z.infer<typeof McpToolArguments>;
export type McpToolOutput = z.infer<typeof McpToolOutput>;
