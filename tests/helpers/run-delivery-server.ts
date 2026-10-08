import { createServer } from "node:http";
import { RunDeliveryEnvelope } from "@/contracts/run-delivery";

export async function startRunDeliveryServer(options: { loseFirstResponse?: boolean; wrongReceipt?: boolean } = {}) {
  const requests: { key: string; payload: RunDeliveryEnvelope }[] = [];
  const receipts = new Map<string, string>();
  let effects = 0;
  const server = createServer((request, response) => {
    void (async () => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const payload = RunDeliveryEnvelope.parse(JSON.parse(body));
      const key = String(request.headers["idempotency-key"] ?? "");
      requests.push({ key, payload });
      if (key !== `delivery:${payload.deliveryId}`) { response.writeHead(400); response.end(); return; }
      if (!receipts.has(key)) { effects++; receipts.set(key, JSON.stringify({ ok: true, deliveryId: options.wrongReceipt ? "00000000-0000-4000-8000-000000000159" : payload.deliveryId, receiptId: `receipt-${effects}` })); }
      if (options.loseFirstResponse && requests.length === 1) { response.writeHead(503); response.end(); return; }
      response.writeHead(200, { "content-type": "application/json" }); response.end(receipts.get(key));
    })().catch(() => { response.writeHead(400); response.end(); });
  });
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试成果接收方未启动");
  return { endpoint: `http://127.0.0.1:${address.port}/result`, requests, effectCount: () => effects,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); } };
}
