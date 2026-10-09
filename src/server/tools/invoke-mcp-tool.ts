import { createMCPClient, MCPClientError, type MCPClient } from "@ai-sdk/mcp";
import { McpToolArguments, MAX_MCP_ARGUMENT_BYTES, MAX_MCP_RESPONSE_BYTES } from "@/contracts/mcp-tool";
import { isPassiveJsonData } from "@/contracts/json";
import { validateJsonObjectSchema } from "@/server/domain/json-schema";
import { mcpToolDefinitionIssue, normalizeMcpToolResult } from "@/server/domain/runtime/mcp-tool";
import type { ToolRegistration } from "@/server/tools/tool-registry";
import type { ToolInvocationResult } from "@/server/tools/invoke-http-tool";

const MCP_TIMEOUT_MS = 30_000;
class McpBoundaryError extends Error {}

export async function invokeMcpTool(args: {
  tool: ToolRegistration; idempotencyKey: string; action: string; input: Record<string, unknown>; outputs: Record<string, unknown>; fetchImpl?: typeof fetch;
}): Promise<ToolInvocationResult> {
  const fail = (error: string, retryable = false): ToolInvocationResult => ({ ok: false, error, retryable });
  const { tool } = args;
  if (tool.protocol !== "mcp-streamable-http" || args.action !== tool.action || !tool.operationKind
    || tool.operationKind === "action" && (tool.businessIdempotency !== true || !tool.businessIdempotencyRetentionMs)) {
    return fail("远端工具尚未确认操作性质或重复调用防重保证");
  }
  if (!isPassiveJsonData(args.input, MAX_MCP_ARGUMENT_BYTES)) return fail("工具参数无效或超过容量限制");
  const input = McpToolArguments.safeParse(args.input);
  if (!input.success || validateJsonObjectSchema(input.data, tool.inputSchema)) return fail("工具参数不符合字段契约");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  let client: MCPClient | undefined;
  let networkFailure = false, boundaryFailure = false, requestCount = 0, totalBytes = 0;
  const boundedFetch: typeof fetch = async (url, options) => {
    if (String(url) !== tool.endpoint || ++requestCount > 20) { boundaryFailure = true; throw new McpBoundaryError(); }
    const headers = new Headers(options?.headers);
    headers.delete("idempotency-key");
    if (typeof options?.body === "string") {
      if (new TextEncoder().encode(options.body).byteLength > MAX_MCP_ARGUMENT_BYTES + 1024) { boundaryFailure = true; throw new McpBoundaryError(); }
      const message = JSON.parse(options.body) as { method?: string };
      // 初始化和发现请求不能共用业务操作防重键。
      if (message.method === "tools/call") headers.set("idempotency-key", args.idempotencyKey);
    }
    let response: Response;
    try {
      response = await (args.fetchImpl ?? fetch)(url, { ...options, headers, redirect: "error",
        signal: options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal });
    } catch (error) { networkFailure = true; throw error; }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_MCP_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined); boundaryFailure = true; throw new McpBoundaryError();
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(destination) {
        try {
          const { done, value } = await reader.read();
          if (done) { decoder.decode(); reader.releaseLock(); destination.close(); return; }
          bytes += value.byteLength; totalBytes += value.byteLength;
          if (bytes > MAX_MCP_RESPONSE_BYTES || totalBytes > 4 * MAX_MCP_RESPONSE_BYTES) { boundaryFailure = true; throw new McpBoundaryError(); }
          try { decoder.decode(value, { stream: true }); } catch { boundaryFailure = true; throw new McpBoundaryError(); }
          destination.enqueue(value);
        } catch (error) {
          await reader.cancel().catch(() => undefined); destination.error(error);
        }
      },
      async cancel(reason) { await reader.cancel(reason).catch(() => undefined); },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  try {
    client = await createMCPClient({
      clientName: "agent-studio", maxRetries: 0,
      initializationOptions: { signal: controller.signal, timeout: MCP_TIMEOUT_MS },
      transport: { type: "http", url: tool.endpoint, headers: tool.headers, redirect: "error", fetch: boundedFetch },
    });
    let cursor: string | undefined;
    let matched: Record<string, unknown> | undefined;
    const cursors = new Set<string>();
    for (let page = 0; page < 5; page += 1) {
      const list = await client.listTools({ params: cursor ? { cursor } : undefined, options: { signal: controller.signal, timeout: MCP_TIMEOUT_MS } });
      if (list.tools.length > 100) return fail("远端工具目录超过允许范围");
      const matches = list.tools.filter((definition) => definition.name === tool.action);
      if (matches.length > 1 || matched && matches.length > 0) return fail("远端工具名称重复，已停止调用");
      if (matches[0]) matched = matches[0].inputSchema;
      cursor = list.nextCursor;
      if (!cursor) break;
      if (cursors.has(cursor) || page === 4) return fail("远端工具目录分页无效或超过允许范围");
      cursors.add(cursor);
    }
    if (!matched) return fail("已登记的工具未在远端目录中找到");
    const issue = mcpToolDefinitionIssue(matched, tool.inputSchema);
    if (issue) return fail(issue);
    const result = await client.callTool({ name: tool.action, arguments: input.data, options: { signal: controller.signal, timeout: MCP_TIMEOUT_MS } });
    return normalizeMcpToolResult(result, tool.outputSchema);
  } catch (error) {
    if (boundaryFailure || error instanceof McpBoundaryError) return fail("远端工具传输内容无效或超过运行边界");
    if (MCPClientError.isInstance(error) && (error.statusCode === 401 || error.statusCode === 403)) return fail("远端工具拒绝访问，请检查服务端凭据");
    if (MCPClientError.isInstance(error) && error.code != null) return fail("远端工具拒绝了业务请求，请核对参数和服务端配置");
    const transient = controller.signal.aborted || networkFailure || MCPClientError.isInstance(error) && error.code == null
      && error.statusCode != null && ([408, 409, 425, 429].includes(error.statusCode) || error.statusCode >= 500);
    return fail(transient ? "远端工具暂时无法连接，稍后自动重试" : "远端工具连接或协议无效，请检查服务端配置", transient);
  } finally {
    // 清理失败不能把已完成的写操作重新解释为失败并触发重复执行。
    try { await client?.close(); } catch { /* 连接可能已关闭。 */ }
    clearTimeout(timer); controller.abort();
  }
}
