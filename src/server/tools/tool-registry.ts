import { z } from "zod";
import { ToolRegistryOption, type ToolRegistryOption as ToolRegistryOptionType } from "@/contracts/tool-registry";
import { validateJsonSchemaDefinition } from "@/server/domain/json-schema";

const ToolRegistration = ToolRegistryOption.extend({
  endpoint: z.string().url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  }),
  method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
  headers: z.record(z.string().trim().min(1).max(100), z.string().max(4_000)).default({}),
});
export type ToolRegistration = z.infer<typeof ToolRegistration>;

let cachedRaw: string | undefined;
let cachedRegistry: ToolRegistration[] = [];

const FORBIDDEN_TOOL_HEADER_NAMES = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function safeHeaders(headers: Record<string, string>): boolean {
  const names = Object.keys(headers);
  if (names.length > 20
    || names.some((name) => /[\r\n:]/.test(name) || FORBIDDEN_TOOL_HEADER_NAMES.has(name.toLowerCase()))
    || Object.values(headers).some((value) => /[\r\n]/.test(value))) return false;
  try {
    new Headers(headers);
    return true;
  } catch {
    return false;
  }
}

export function parseToolRegistry(raw: string | undefined): ToolRegistration[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = z.array(ToolRegistration).max(50).safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    const ids = new Set<string>();
    for (const tool of parsed.data) {
      if (tool.protocol === "mcp-streamable-http" && (
        tool.method !== "POST" || !tool.operationKind
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tool.action)
        || tool.operationKind === "action" && tool.businessIdempotency !== true
      )) return [];
      if (tool.businessIdempotency === true && tool.businessIdempotencyRetentionMs === undefined) return [];
      if (ids.has(tool.id) || !safeHeaders(tool.headers)) return [];
      if (validateJsonSchemaDefinition(tool.inputSchema) || validateJsonSchemaDefinition(tool.outputSchema)) return [];
      ids.add(tool.id);
    }
    return parsed.data;
  } catch {
    return [];
  }
}

export function loadToolRegistry(): ToolRegistration[] {
  const raw = process.env.TOOL_REGISTRY_JSON;
  if (raw === cachedRaw) return cachedRegistry;
  cachedRaw = raw;
  cachedRegistry = parseToolRegistry(raw);
  if (raw?.trim() && cachedRegistry.length === 0) console.error("[tool-registry] 工具注册表配置无效");
  return cachedRegistry;
}

export function listToolRegistryOptions(): ToolRegistryOptionType[] {
  return loadToolRegistry().map((tool) => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    action: tool.action,
    scope: tool.scope,
    risk: tool.risk,
    ...(tool.protocol !== undefined ? { protocol: tool.protocol } : {}),
    ...(tool.operationKind !== undefined ? { operationKind: tool.operationKind } : {}),
    ...(tool.businessIdempotency !== undefined ? { businessIdempotency: tool.businessIdempotency } : {}),
    ...(tool.businessIdempotencyRetentionMs !== undefined ? { businessIdempotencyRetentionMs: tool.businessIdempotencyRetentionMs } : {}),
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  }));
}

export function listToolCompilerCapabilities(): unknown[] {
  return listToolRegistryOptions().map((tool) => ({
    id: tool.id,
    label: tool.name,
    action: tool.action,
    searchText: tool.description,
    scope: tool.scope,
    source: "connected-registry",
    risk: tool.risk,
    registryToolId: tool.id,
    protocol: tool.protocol ?? "http-json",
    ...(tool.operationKind !== undefined ? { operationKind: tool.operationKind } : {}),
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  }));
}

export function getToolRegistration(id: string | null | undefined): ToolRegistration | null {
  if (!id) return null;
  return loadToolRegistry().find((tool) => tool.id === id) ?? null;
}
