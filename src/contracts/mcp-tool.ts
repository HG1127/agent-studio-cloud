import { z } from "zod";
import { boundedJsonStorageValue, JsonStorageRecord } from "./json";

export const MAX_MCP_ARGUMENT_BYTES = 512 * 1024;
export const MAX_MCP_RESPONSE_BYTES = 1024 * 1024;
export const McpToolArguments = boundedJsonStorageValue(MAX_MCP_ARGUMENT_BYTES, "工具参数").pipe(JsonStorageRecord);
export const McpToolOutput = boundedJsonStorageValue(MAX_MCP_RESPONSE_BYTES, "工具回执").pipe(JsonStorageRecord);
export type McpToolArguments = z.infer<typeof McpToolArguments>;
export type McpToolOutput = z.infer<typeof McpToolOutput>;
