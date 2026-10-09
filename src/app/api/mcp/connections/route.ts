import { NextResponse } from "next/server";
import { McpConnectionListResult } from "@/contracts/mcp-connection";
import { listMcpConnections } from "@/server/queries/mcp-connections";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json(McpConnectionListResult.parse({ connections: listMcpConnections() }), { headers: { "Cache-Control": "no-store" } });
}
