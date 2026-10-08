import { createServer } from "node:http";

export async function startModelJsonServer(replies: string[], responseStatuses: number[] = []) {
  const modelRequests: Record<string, unknown>[] = [];
  const toolRequests: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const payload = JSON.parse(body || "{}") as Record<string, unknown>;
      if (request.url?.endsWith("/chat/completions")) {
        const index = modelRequests.push(payload) - 1;
        const status = responseStatuses[index] ?? 200;
        if (status !== 200) {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "测试供应商暂时不可用", type: "test-unavailable" } }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "test-completion-" + index, object: "chat.completion", created: 1, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: replies[Math.min(index, replies.length - 1)] }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
        }));
      } else if (request.url === "/invoke") {
        toolRequests.push(payload);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      } else {
        response.writeHead(404);
        response.end();
      }
    })().catch(() => { response.writeHead(400); response.end(); });
  });
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", () => resolve()).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试模型服务未启动");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    modelRequests,
    toolRequests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
