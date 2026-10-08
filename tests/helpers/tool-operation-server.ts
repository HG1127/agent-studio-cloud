import { createServer } from "node:http";

export async function startToolOperationServer(loseFirstResponse = false) {
  const requests: Array<{ key: string; payload: Record<string, unknown> }> = [];
  const receipts = new Map<string, string>();
  let effects = 0;
  const server = createServer((request, response) => {
    void (async () => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const key = String(request.headers["idempotency-key"] ?? "");
      requests.push({ key, payload: JSON.parse(body) as Record<string, unknown> });
      if (!key || request.url !== "/invoke") { response.writeHead(400); response.end(); return; }
      if (!receipts.has(key)) {
        effects += 1;
        receipts.set(key, JSON.stringify({ receiptId: "receipt-" + effects }));
      }
      if (loseFirstResponse && requests.length === 1) { response.writeHead(503); response.end(); return; }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(receipts.get(key));
    })().catch(() => { response.writeHead(400); response.end(); });
  });
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试业务服务未启动");
  return {
    endpoint: `http://127.0.0.1:${address.port}/invoke`, requests, effectCount: () => effects,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
