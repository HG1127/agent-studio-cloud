import { AgentManifest } from "@/contracts/manifest";
import { workflowCollaborationKeys } from "@/server/domain/import-agent";

export type CollaborationVersionDependency = {
  versionId: string;
  agentId: string;
  agentName: string;
  status: string;
  agentArchivedAt: Date | null;
  manifest: unknown;
};

function dependencyKeys(manifest: unknown): string[] {
  const parsed = AgentManifest.safeParse(manifest);
  return parsed.success ? workflowCollaborationKeys(parsed.data.workflowSnapshot) : [];
}

export function activeVersionDependingOnAgent(
  versions: CollaborationVersionDependency[],
  targetAgentId: string,
): { agentId: string; agentName: string } | null {
  const byKey = new Map(versions.map((version) => [`${version.agentId}:${version.versionId}`, version]));
  const dependencies = new Map(versions.map((version) => [version.versionId, dependencyKeys(version.manifest)]));
  const roots = versions.filter((version) =>
    version.agentArchivedAt === null
    && version.agentId !== targetAgentId
    && ["production", "candidate"].includes(version.status));

  for (const root of roots) {
    const pending = [...(dependencies.get(root.versionId) ?? [])];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const key = pending.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      const separator = key.lastIndexOf(":");
      const agentId = key.slice(0, separator);
      if (agentId === targetAgentId) return { agentId: root.agentId, agentName: root.agentName };
      const dependency = byKey.get(key);
      if (!dependency || dependency.agentArchivedAt !== null) continue;
      pending.push(...(dependencies.get(dependency.versionId) ?? []));
    }
  }
  return null;
}
