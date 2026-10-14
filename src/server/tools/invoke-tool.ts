import { invokeHttpTool } from "@/server/tools/invoke-http-tool";
import { invokeMcpTool } from "@/server/tools/invoke-mcp-tool";

export function invokeRegisteredTool(args: Parameters<typeof invokeHttpTool>[0]) {
  return args.tool.protocol === "mcp-streamable-http" ? invokeMcpTool(args) : invokeHttpTool(args);
}
