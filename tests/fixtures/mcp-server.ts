import { createServer } from "node:http";

export async function startMcpTestServer(args: {
  inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown>; output?: unknown; isError?: boolean; missing?: boolean; duplicate?: boolean;
  status?: number; text?: string; paginate?: boolean; cursorCycle?: boolean; drift?: boolean; sse?: boolean; invalidUtf8?: boolean; loseFirstResponse?: boolean;
} = {}) {
  const messages: Array<{ method: string; params?: Record<string, unknown>; key?: string }> = [];
  let closed = false;
  let effects = 0, responseLost = false;
  const operationKeys = new Set<string>();
  const schema = args.inputSchema ?? { type: "object", required: ["customerId"], properties: { customerId: { type: "string" } }, additionalProperties: false };
  const server = createServer(async (request, response) => {
    if (request.method === "GET") { response.writeHead(405); response.end(); return; }
    if (request.method === "DELETE") { closed = true; response.writeHead(204); response.end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id?: string; method: string; params?: Record<string, unknown> };
    messages.push({ method: message.method, params: message.params, key: request.headers["idempotency-key"] as string | undefined });
    if (message.method.startsWith("notifications/")) { response.writeHead(202); response.end(); return; }
    let result: unknown;
    if (message.method === "server/discover") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "legacy test server" } })); return;
    }
    if (message.method === "initialize") result = {
      protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "local-test", version: "1.0" },
      instructions: "untrusted remote instruction, never a system prompt",
    };
    else if (message.method === "tools/list") {
      const tool = { name: "lookup_customer", description: "测试工具", inputSchema: args.drift ? { type: "object" } : schema,
        ...(args.outputSchema !== undefined ? { outputSchema: args.outputSchema } : {}) };
      result = { tools: args.missing || args.paginate && !message.params?.cursor ? [] : args.duplicate ? [tool, tool] : [tool],
        ...(args.cursorCycle || args.paginate && !message.params?.cursor ? { nextCursor: "page-2" } : {}) };
    } else if (message.method === "tools/call") {
      const key = request.headers["idempotency-key"] as string | undefined;
      if (!args.loseFirstResponse || !key || !operationKeys.has(key)) effects += 1;
      if (key) operationKeys.add(key);
      if (args.loseFirstResponse && !responseLost) { responseLost = true; response.destroy(); return; }
      if (args.status) { response.writeHead(args.status, { "content-type": "application/json" }); response.end('{"secret":"never-log"}'); return; }
      if (args.invalidUtf8) { response.writeHead(200, { "content-type": "application/json" }); response.end(Buffer.from([0xff])); return; }
      result = { content: [{ type: "text", text: args.text ?? "fallback not selected" }],
        ...(args.text !== undefined ? {} : { structuredContent: args.output ?? { customerId: "c1", amount: 0, active: false } }),
        ...(args.isError ? { isError: true } : {}) };
    } else result = {};
    const body = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
    response.writeHead(200, { "content-type": args.sse && message.method === "tools/call" ? "text/event-stream" : "application/json", "mcp-session-id": "local-session" });
    response.end(args.sse && message.method === "tools/call" ? `event: message\ndata: ${body}\n\n` : body);
  });
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("本地服务未启动");
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`, schema, messages, wasClosed: () => closed,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
    effectCount: () => effects,
  };
}
