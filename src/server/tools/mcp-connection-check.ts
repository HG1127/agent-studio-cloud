import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { McpToolDirectory, type McpConnectionRegistration, type McpConnectionCheckResult } from "@/contracts/mcp-connection";
import { compareMcpDirectory, mcpCheckFailure } from "@/server/domain/mcp-connection";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1024 * 1024;
const allowedMethods = new Set(["initialize", "notifications/initialized", "tools/list"]);
class CheckBoundaryError extends Error {}

export async function checkMcpConnection(registration: McpConnectionRegistration, fetchImpl: typeof fetch = fetch): Promise<McpConnectionCheckResult> {
  const endpoint = new URL(registration.endpoint).href;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let client: MCPClient | undefined;
  let failure: "credentials-rejected" | "protocol-error" | "unavailable" = "protocol-error";
  let requests = 0, totalBytes = 0, terminalFailure = false, closing = false, cleanupRequests = 0;
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const boundedFetch: typeof fetch = async (url, options) => {
    const method = options?.method?.toUpperCase() ?? "GET";
    if (closing && method === "DELETE" && String(url) === endpoint && ++cleanupRequests === 1) {
      const headers = new Headers(options?.headers);
      headers.delete("cookie"); headers.delete("idempotency-key");
      const response = await fetchImpl(url, { ...options, headers, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(1000) });
      await response.body?.cancel().catch(() => undefined);
      return new Response(null, { status: 204 });
    }
    if (terminalFailure || controller.signal.aborted || String(url) !== endpoint || ++requests > 12) throw new CheckBoundaryError();
    // 检查不订阅服务端事件；SDK 将 405 视为未提供独立事件流。
    if (method === "GET") return new Response(null, { status: 405 });
    if (method === "POST") {
      if (typeof options?.body !== "string" || new TextEncoder().encode(options.body).byteLength > 16 * 1024) throw new CheckBoundaryError();
      const rpc = JSON.parse(options.body) as { method?: string };
      if (!rpc.method || !allowedMethods.has(rpc.method)) throw new CheckBoundaryError();
    } else if (method !== "GET" && method !== "DELETE") throw new CheckBoundaryError();
    const headers = new Headers(options?.headers);
    headers.delete("cookie"); headers.delete("idempotency-key");
    let response: Response;
    try {
      response = await fetchImpl(url, { ...options, headers, redirect: "error", credentials: "omit",
        signal: options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal });
    } catch (error) { terminalFailure = true; failure = "unavailable"; throw error; }
    if (response.status === 401 || response.status === 403) failure = "credentials-rejected";
    else if (response.status === 408 || response.status === 429 || response.status >= 500) failure = "unavailable";
    if (!response.ok && response.status !== 202) {
      terminalFailure = true;
      await response.body?.cancel().catch(() => undefined);
      throw new CheckBoundaryError();
    }
    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) {
      terminalFailure = true; failure = "protocol-error"; await response.body?.cancel().catch(() => undefined); throw new CheckBoundaryError();
    }
    if (!response.body) return response;
    const reader = response.body.getReader(); readers.add(reader);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const stream = new ReadableStream<Uint8Array>({
      async pull(destination) {
        try {
          const { done, value } = await reader.read();
          if (done) { decoder.decode(); readers.delete(reader); reader.releaseLock(); destination.close(); return; }
          totalBytes += value.byteLength;
          if (totalBytes > MAX_BYTES) throw new CheckBoundaryError();
          decoder.decode(value, { stream: true }); destination.enqueue(value);
        } catch (error) { terminalFailure = true; failure = "protocol-error"; await reader.cancel().catch(() => undefined); readers.delete(reader); destination.error(error); }
      },
      async cancel(reason) { readers.delete(reader); await reader.cancel(reason).catch(() => undefined); },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  try {
    client = await createMCPClient({ clientName: "agent-studio-connection-check", maxRetries: 0, protocolVersionDiscovery: false,
      initializationOptions: { signal: controller.signal, timeout: TIMEOUT_MS },
      transport: { type: "http", url: endpoint, headers: registration.headers, redirect: "error", fetch: boundedFetch },
    });
    const definitions: McpToolDirectory = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const list = await client.listTools({ params: cursor ? { cursor } : undefined, options: { signal: controller.signal, timeout: TIMEOUT_MS } });
      const parsed = McpToolDirectory.safeParse(list.tools);
      if (!parsed.success || definitions.length + parsed.data.length > 100) return mcpCheckFailure("protocol-error");
      definitions.push(...parsed.data);
      cursor = list.nextCursor;
      if (!cursor) return compareMcpDirectory(registration, definitions);
      if (cursor.length > 1000 || cursors.has(cursor) || page === 4) return mcpCheckFailure("protocol-error");
      cursors.add(cursor);
    }
    return mcpCheckFailure("protocol-error");
  } catch { return mcpCheckFailure(controller.signal.aborted ? "unavailable" : failure); }
  finally {
    closing = true; controller.abort(); clearTimeout(timer);
    await Promise.allSettled([...readers].map((reader) => reader.cancel()));
    try { await client?.close(); } catch { /* 连接已终止，清理失败不改变检查结论。 */ }
  }
}
