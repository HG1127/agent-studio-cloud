import { ToolRegistryOption } from "@/contracts/tool-registry";

type CatalogTool = Pick<ToolRegistryOption, "id" | "name" | "description" | "risk">;
const requiredDetails = ["id", "name", "description", "action", "scope", "risk", "inputSchema", "outputSchema"] as const;

export function readToolRegistryDefinitions(value: unknown): ToolRegistryOption[] | null {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || requiredDetails.some((key) => !Object.hasOwn(item, key) || item[key] === undefined))) return null;
  const parsed = ToolRegistryOption.array().max(50).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map((tool) => tool.id)).size !== parsed.data.length) return null;
  try { JSON.stringify(parsed.data); } catch { return null; }
  return parsed.data;
}

export function catalogToolDefinition(tool: CatalogTool, definitions: ToolRegistryOption[] | undefined): ToolRegistryOption | null {
  if (!definitions) return null;
  const matching = definitions.filter((definition) => definition.id === tool.id);
  const parsed = matching.length === 1 ? readToolRegistryDefinitions(matching) : null;
  const value = parsed?.[0];
  if (!value || value.name !== tool.name || value.description !== tool.description || value.risk !== tool.risk) return null;
  if (["action", "scope", "inputSchema", "outputSchema"].some((key) => Object.hasOwn(tool, key))) {
    const current = readToolRegistryDefinitions([tool]);
    if (!current || JSON.stringify(current[0]) !== JSON.stringify(value)) return null;
  }
  return value;
}
