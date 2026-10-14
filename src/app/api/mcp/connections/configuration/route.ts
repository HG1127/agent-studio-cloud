import { NextResponse } from "next/server";
import { McpConnectionConfigurationResult } from "@/contracts/mcp-connection";
import { getMcpConnectionConfiguration } from "@/server/queries/mcp-connections";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(McpConnectionConfigurationResult.parse(getMcpConnectionConfiguration()), { headers: { "Cache-Control": "no-store" } });
}
