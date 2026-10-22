import type { ToolRegistryOption } from "@/contracts/tool-registry";

export function selectedRegistryToolSpec(toolId: string, currentAction: string, options: readonly ToolRegistryOption[], maxRetries = 3) {
  const selected = options.find((item) => item.id === toolId);
  if (!selected) return {
    connector: toolId === "demo" ? "demo" : "unbound", action: toolId === "demo" ? currentAction || "demo" : "", scope: toolId === "demo" ? "demo" : "", risk: toolId === "demo" ? "low" as const : "high" as const,
    maxRetries: toolId === "demo" ? 1 : 3, registryToolId: toolId === "demo" ? "demo" : null, protocol: toolId === "demo" ? "demo" : "unbound", unresolved: toolId !== "demo",
    inputSchema: { type: "object" }, outputSchema: { type: "object" },
  };
  return {
    connector: selected.name, action: selected.action, scope: selected.scope, risk: selected.risk,
    maxRetries, registryToolId: selected.id, protocol: selected.protocol ?? "http-json", unresolved: false,
    ...(selected.operationKind === undefined ? {} : { operationKind: selected.operationKind }),
    inputSchema: selected.inputSchema, outputSchema: selected.outputSchema,
  };
}
