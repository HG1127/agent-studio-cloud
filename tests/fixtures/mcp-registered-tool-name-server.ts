import { createServer } from "node:http";

export async function startRegisteredNameMcpServer(action: string) {
  const messages: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const inputSchema = { type: "object", properties: { amount: { type: "number" }, approved: { type: "boolean" } }, required: ["amount", "approved"], additionalProperties: false };
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === "GET") { response.writeHead(405); response.end(); return; }
      if (request.method === "DELETE") { response.writeHead(204); response.end(); return; }
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const rpc = JSON.parse(body) as { method: string; id?: number; params?: Record<string, unknown> };
      messages.push({ method: rpc.method, params: rpc.params });
      if (rpc.method === "notifications/initialized") { response.writeHead(202); response.end(); return; }
      response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "registered-name-test" });
      if (rpc.method === "server/discover") { response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "legacy test" } })); return; }
      const result = rpc.method === "initialize"
        ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "registered-name-test", version: "1" } }
        : rpc.method === "tools/list" ? { tools: [{ name: action, inputSchema }] }
          : { content: [], structuredContent: { receiptId: "test-receipt", amount: 0, approved: false } };
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    })().catch(() => { if (!response.headersSent) response.writeHead(400); response.end(); });
  });
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("本机测试服务未启动");
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`, inputSchema, messages,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}
