import { NextResponse } from "next/server";
import { McpConnectionCheckInput, McpConnectionCheckResult, McpConnectionRequestError } from "@/contracts/mcp-connection";
import { inspectMcpConnection } from "@/server/queries/mcp-connections";
import { hasSameOrigin } from "@/server/security/request-origin";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const fail = (error: string, status: number) => NextResponse.json(McpConnectionRequestError.parse({ error }), { status, headers });
  if (!hasSameOrigin(request)) return fail("请求来源无效", 403);
  let body: unknown;
  try {
    const result = await readBoundedRequestText(request, 1024);
    if (!result.ok) return fail("检查参数无效或超过限制", 400);
    body = JSON.parse(result.text);
  } catch { return fail("检查参数无效或超过限制", 400); }
  const input = McpConnectionCheckInput.safeParse(body);
  if (!input.success) return fail("检查参数无效", 400);
  const result = McpConnectionCheckResult.parse(await inspectMcpConnection(input.data.connectionId));
  return NextResponse.json(result, { status: result.status === "not-found" ? 404 : 200, headers });
}
