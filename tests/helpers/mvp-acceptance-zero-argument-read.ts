import { createServer } from "node:http";
import { vi } from "vitest";
import type { Run } from "workflow/api";
import { MvpTemplateInput } from "@/contracts/mvp-template";
import { buildMvpTemplate } from "@/server/domain/mvp-template";
import { listToolRegistryOptions, parseToolRegistry } from "@/server/tools/tool-registry";
import { assertMvpAcceptanceIsolatedDb, cleanupMvpAcceptanceTemplate, prepareMvpAcceptanceTemplate, type MvpAcceptanceTemplateContext } from "./mvp-acceptance-template";

import { stopRegisteredNameTestRuns } from "./mcp-registered-tool-name-cleanup";

type RpcMessage = { id?: string | number; method: string; params?: Record<string, unknown> };

async function startZeroArgumentRead(inputSchema: Record<string, unknown>) {
  const messages: Array<RpcMessage & { body: string }> = [];
  const facts = { customerId: "c1", amount: 0, active: false };
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url !== "/mcp-zero-read") { response.writeHead(404); response.end(); return; }
      if (request.method === "GET") { response.writeHead(405); response.end(); return; }
      if (request.method === "DELETE") { response.writeHead(204); response.end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString("utf8");
      const message = JSON.parse(body) as RpcMessage;
      messages.push({ ...message, body });
      if (message.method.startsWith("notifications/")) { response.writeHead(202); response.end(); return; }
      if (message.method === "server/discover") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "legacy local service" } }));
        return;
      }
      let result: unknown;
      if (message.method === "initialize") result = {
        protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "acceptance-zero-read", version: "1.0" },
      };
      else if (message.method === "tools/list") result = { tools: [{ name: "lookup_customer", inputSchema }] };
      else if (message.method === "tools/call") {
        const input = message.params?.arguments;
        const empty = input !== null && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 0;
        result = message.params?.name === "lookup_customer" && empty
          ? { content: [], structuredContent: facts }
          : { isError: true, content: [{ type: "text", text: "只允许显式空参数读取" }] };
      } else { response.writeHead(400); response.end(); return; }
      response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "acceptance-zero-read" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    })().catch(() => { response.writeHead(400); response.end(); });
  });
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("零参数取数假服务未启动");
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp-zero-read`, inputSchema, facts, messages,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function closeOnce(close: () => Promise<void>) {
  let closing: Promise<void> | undefined;
  return () => closing ??= Promise.resolve().then(close);
}

async function closeServices(closes: Array<() => Promise<void> | undefined>) {
  try {
    const results = await Promise.allSettled(closes.map((close) => Promise.resolve().then(close)));
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "零参数验收假服务关闭失败");
  } finally { vi.unstubAllEnvs(); }
}

export async function prepareZeroArgumentReadTemplate(inputSchema: Record<string, unknown>) {
  assertMvpAcceptanceIsolatedDb();
  const read = await startZeroArgumentRead(inputSchema);
  let base: MvpAcceptanceTemplateContext | undefined;
  try {
    const prepared = await prepareMvpAcceptanceTemplate();
    base = { ...prepared, tools: { ...prepared.tools, close: closeOnce(prepared.tools.close) }, model: { ...prepared.model, close: closeOnce(prepared.model.close) } };
    const registry = parseToolRegistry(JSON.stringify(base.registry.map((tool) => tool.id === base!.spec.readToolId
      ? { ...tool, endpoint: read.endpoint, inputSchema } : tool)));
    if (registry.length !== 2) throw new Error("零参数取数工具登记无效");
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify(registry));
    const spec = MvpTemplateInput.parse({ ...base.spec, readMapping: { fields: [], includeUpstreamOutputs: false } });
    const built = buildMvpTemplate(spec, listToolRegistryOptions());
    if (!built.ok) throw new Error(`零参数生产模板工厂拒绝：${built.error}`);
    return { ...base, registry, spec, built, read: { ...read, close: closeOnce(read.close) },
      workflowHandles: [] as Array<Run<unknown>>, pendingStartRunIds: new Set<string>() };
  } catch (error) {
    try { await closeServices([() => base?.tools.close(), () => base?.model.close(), read.close]); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "零参数验收准备和关闭失败"); }
    throw error;
  }
}
export type ZeroArgumentReadContext = Awaited<ReturnType<typeof prepareZeroArgumentReadTemplate>>;

export async function cleanupZeroArgumentReadTemplate(context: ZeroArgumentReadContext) {
  const errors: unknown[] = [];
  try {
    await stopRegisteredNameTestRuns(context.workflowHandles, [...context.pendingStartRunIds]);
    await cleanupMvpAcceptanceTemplate(context);
  } catch (error) { errors.push(error); }
  finally {
    try { await closeServices([context.tools.close, context.model.close, context.read.close]); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "零参数验收清理失败，未确认停止时保留数据库记录");
}
