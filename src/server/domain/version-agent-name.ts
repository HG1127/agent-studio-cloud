import { AgentCreateInput } from "@/contracts/agent";
import type { AgentManifest } from "@/contracts/manifest";

export function versionAgentName(manifest: AgentManifest, fallback: string): string {
  const frozenName = AgentCreateInput.shape.name.safeParse(manifest.workflowSnapshot.rootAgent.name);
  return frozenName.success ? frozenName.data : fallback;
}
