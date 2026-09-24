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

function safeHeaders(headers: Record<string, string>): boolean {
  const names = Object.keys(headers);
  return names.length <= 20 && names.every((name) => !/[\r\n:]/.test(name))
    && Object.values(headers).every((value) => !/[\r\n]/.test(value));
}

export function parseToolRegistry(raw: string | undefined): ToolRegistration[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = z.array(ToolRegistration).max(50).safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    const ids = new Set<string>();
    for (const tool of parsed.data) {
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
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  }));
}

export function getToolRegistration(id: string | null | undefined): ToolRegistration | null {
  if (!id) return null;
  return loadToolRegistry().find((tool) => tool.id === id) ?? null;
}
