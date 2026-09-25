import type { WorkflowNode } from "@/contracts/workflow";
import type { ToolRegistration } from "@/server/tools/tool-registry";

type ToolSnapshot = NonNullable<WorkflowNode["tool"]>;

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  });
}

export function toolRegistrationCompatibilityIssue(
  snapshot: ToolSnapshot,
  registration: ToolRegistration,
): string | null {
  if (
    snapshot.registryToolId !== registration.id
    || snapshot.action !== registration.action
    || snapshot.scope !== registration.scope
    || snapshot.risk !== registration.risk
    || canonicalJson(snapshot.inputSchema) !== canonicalJson(registration.inputSchema)
    || canonicalJson(snapshot.outputSchema) !== canonicalJson(registration.outputSchema)
  ) {
    return "绑定的业务工具配置已变化，请重新发布助手";
  }
  return null;
}
