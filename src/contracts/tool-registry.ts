import { z } from "zod";
import { McpRemoteToolName } from "./mcp-tool";

export const ToolRegistryConfigurationStatus = z.enum(["not-configured", "configured", "configuration-error"]);
export type ToolRegistryConfigurationStatus = z.infer<typeof ToolRegistryConfigurationStatus>;

export const ToolRegistryOption = z.object({
  id: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).default(""),
  action: z.string().trim().min(1).max(128),
  scope: z.string().trim().min(1).max(100),
  risk: z.enum(["low", "medium", "high"]).default("high"),
  protocol: z.enum(["http-json", "mcp-streamable-http"]).optional(),
  operationKind: z.enum(["read", "action"]).optional(),
  businessIdempotency: z.boolean().optional(),
  businessIdempotencyRetentionMs: z.number().int().min(300_000).max(31_536_000_000).optional(),
  inputSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
  outputSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
}).superRefine((tool, context) => {
  const valid = tool.protocol === "mcp-streamable-http"
    ? McpRemoteToolName.safeParse(tool.action).success : tool.action.length <= 100;
  if (!valid) context.addIssue({ code: "custom", path: ["action"], message: "工具操作名称不符合登记协议的要求" });
});
export type ToolRegistryOption = z.infer<typeof ToolRegistryOption>;
