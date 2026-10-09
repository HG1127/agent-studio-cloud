import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { AgentManifest } from "@/contracts/manifest";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import { createMcpMvpFixture } from "../fixtures/mcp-mvp";

export const MvpAcceptanceProposalSchema = {
  type: "object", required: ["customerId", "amount", "approved"], additionalProperties: false,
  properties: { customerId: { type: "string" }, amount: { type: "number" }, approved: { type: "boolean" } },
};
export const MvpAcceptanceReceiptSchema = {
  ...MvpAcceptanceProposalSchema,
  required: ["ok", "receiptId", "customerId", "amount", "approved"],
  properties: { ...MvpAcceptanceProposalSchema.properties, ok: { const: true }, receiptId: { type: "string" } },
};

type RpcMessage = { id?: string | number; method: string; params?: Record<string, unknown> };
type WriteFault = "none" | "response-lost" | "response-lost-always" | "invalid-receipt" | "forbidden";

export async function startMvpAcceptanceTools() {
  const readSchema = { type: "object", required: ["customerId"], additionalProperties: false, properties: { customerId: { type: "string" } } };
  const messages: Array<RpcMessage & { path: string; key?: string }> = [];
  const writes: Array<{ key: string; arguments: Record<string, unknown> }> = [];
  const receipts = new Map<string, Record<string, unknown>>();
  const controls: { readDrift: boolean; readStatus: number | null; writeDrift: boolean; writeFault: WriteFault } = {
    readDrift: false, readStatus: null, writeDrift: false, writeFault: "none",
  };
  let effects = 0;
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === "GET") { response.writeHead(405); response.end(); return; }
      if (request.method === "DELETE") { response.writeHead(204); response.end(); return; }
      const path = request.url ?? "";
      if (path !== "/mcp-read" && path !== "/mcp-write") { response.writeHead(404); response.end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RpcMessage;
      const key = request.headers["idempotency-key"] as string | undefined;
      messages.push({ ...message, path, key });
      if (message.method.startsWith("notifications/")) { response.writeHead(202); response.end(); return; }
      if (message.method === "server/discover") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "legacy local service" } })); return;
      }
      const read = path === "/mcp-read";
      let result: unknown;
      if (message.method === "initialize") result = {
        protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "acceptance-local", version: "1.0" },
      };
      else if (message.method === "tools/list") result = { tools: [{
        name: read ? "lookup_customer" : "record_proposal",
        inputSchema: (read ? controls.readDrift : controls.writeDrift) ? { type: "object" } : read ? readSchema : MvpAcceptanceProposalSchema,
      }] };
      else if (message.method === "tools/call") {
        const input = (message.params?.arguments ?? {}) as Record<string, unknown>;
        if (read && controls.readStatus || !read && controls.writeFault === "forbidden") {
          response.writeHead(read ? controls.readStatus! : 403, { "content-type": "application/json" });
          response.end('{"apiKey":"test-only-never-log"}'); return;
        }
        if (read) result = { content: [], structuredContent: { customerId: input.customerId, amount: 0, active: false } };
        else {
          writes.push({ key: key ?? "", arguments: input });
          if (!key) { response.writeHead(400); response.end(); return; }
          if (!receipts.has(key)) {
            effects += 1;
            receipts.set(key, { ok: true, receiptId: `receipt-${effects}`, ...input });
          }
          if (controls.writeFault === "response-lost-always" || controls.writeFault === "response-lost" && writes.length === 1) {
            response.writeHead(503); response.end(); return;
          }
          result = { content: [], structuredContent: controls.writeFault === "invalid-receipt"
            ? { ok: true, receiptId: 123, apiKey: "test-only-never-log" } : receipts.get(key) };
        }
      } else {
        response.writeHead(400); response.end(); return;
      }
      response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "acceptance-local" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    })().catch(() => { response.writeHead(400); response.end(); });
  });
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("验收假服务未启动");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    readEndpoint: `${baseUrl}/mcp-read`, writeEndpoint: `${baseUrl}/mcp-write`, readSchema, messages, writes, controls,
    effectCount: () => effects,
    receipt: (key: string) => receipts.get(key),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

export function createMvpAcceptanceFixture(service: Awaited<ReturnType<typeof startMvpAcceptanceTools>>) {
  const base = createMcpMvpFixture(service.readEndpoint, service.writeEndpoint, service.readSchema);
  const registry = parseToolRegistry(JSON.stringify([base.registry[0], {
    ...base.registry[1], protocol: "mcp-streamable-http", operationKind: "action",
    inputSchema: MvpAcceptanceProposalSchema, outputSchema: MvpAcceptanceReceiptSchema,
  }]));
  if (registry.length !== 2) throw new Error("验收工具登记失败");
  const write = registry[1];
  const fields = [...base.fields, { path: "交付.业务回执", label: "业务回执", required: true, sourceNodeId: "record", sourcePath: ["receiptId"] }];
  const agentId = randomUUID();
  const manifest = AgentManifest.parse({
    ...base.manifest, workflowFingerprint: "mvp-runtime-acceptance", outputContract: { fields },
    workflowSnapshot: {
      ...base.manifest.workflowSnapshot, rootAgent: { ...base.manifest.workflowSnapshot.rootAgent, id: agentId }, outputContract: { fields },
      nodes: { ...base.manifest.workflowSnapshot.nodes, record: {
        ...base.manifest.workflowSnapshot.nodes.record,
        retry: { maxAttempts: 2, backoffMs: 50 },
        tool: { connector: write.name, registryToolId: write.id, action: write.action, scope: write.scope, risk: write.risk,
          protocol: write.protocol, operationKind: write.operationKind, inputSchema: write.inputSchema, outputSchema: write.outputSchema },
        toolOperation: { scope: `acceptance-${randomUUID()}`, key: { kind: "input", path: ["requestId"] } },
      } },
    },
  });
  return { registry, manifest, agentId, input: { requestId: randomUUID(), customerId: "c1", private: "must-not-send" } };
}
