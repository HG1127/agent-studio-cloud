import { AgentManifest } from "@/contracts/manifest";
import { workflowCollaborationKeys } from "@/server/domain/import-agent";
import { MAX_COLLABORATION_DEPTH } from "@/server/domain/runtime/collaboration-chain";

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

export type CollaborationGraphInspection = {
  issue: string | null;
  agentIds: string[];
  versionIds: string[];
  knowledgeSourceIds: string[];
};

export function inspectCollaborationVersionGraph(args: {
  rootAgentId: string;
  directKeys: string[];
  versions: CollaborationVersionDependency[];
}): CollaborationGraphInspection {
  const byKey = new Map(args.versions.map((version) => [`${version.agentId}:${version.versionId}`, version]));
  const agentIds = new Set<string>();
  const versionIds = new Set<string>();
  const knowledgeSourceIds = new Set<string>();
  let issue: string | null = null;

  const visit = (key: string, depth: number, path: ReadonlySet<string>) => {
    if (issue) return;
    const separator = key.lastIndexOf(":");
    const agentId = key.slice(0, separator);
    const versionId = key.slice(separator + 1);
    if (!agentId || !versionId) {
      issue = "协作助手信息不完整";
      return;
    }
    if (path.has(agentId)) {
      issue = "协作助手之间形成了循环调用";
      return;
    }
    if (depth > MAX_COLLABORATION_DEPTH) {
      issue = `协作助手超过最多 ${MAX_COLLABORATION_DEPTH} 层的限制`;
      return;
    }
    const version = byKey.get(key);
    const manifest = version ? AgentManifest.safeParse(version.manifest) : null;
    if (!version || version.agentArchivedAt !== null || !manifest?.success) {
      issue = "协作链包含已停用、缺失或格式不完整的冻结版本";
      return;
    }
    agentIds.add(agentId);
    versionIds.add(versionId);
    for (const sourceId of manifest.data.knowledgeSnapshot) knowledgeSourceIds.add(sourceId);
    const nextPath = new Set(path);
    nextPath.add(agentId);
    for (const dependencyKey of workflowCollaborationKeys(manifest.data.workflowSnapshot)) {
      visit(dependencyKey, depth + 1, nextPath);
    }
  };

  for (const key of [...new Set(args.directKeys)]) {
    visit(key, 1, new Set([args.rootAgentId]));
  }
  return { issue, agentIds: [...agentIds], versionIds: [...versionIds], knowledgeSourceIds: [...knowledgeSourceIds] };
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

export function activeVersionDependingOnKnowledgeSource(
  versions: CollaborationVersionDependency[],
  targetSourceId: string,
): { agentId: string; agentName: string } | null {
  const byKey = new Map(versions.map((version) => [`${version.agentId}:${version.versionId}`, version]));
  const roots = versions.filter((version) =>
    version.agentArchivedAt === null
    && ["production", "candidate"].includes(version.status));
  for (const root of roots) {
    const pending = [root];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      const key = `${current.agentId}:${current.versionId}`;
      if (visited.has(key) || current.agentArchivedAt !== null) continue;
      visited.add(key);
      const manifest = AgentManifest.safeParse(current.manifest);
      if (!manifest.success) continue;
      if (manifest.data.knowledgeSnapshot.includes(targetSourceId)) {
        return { agentId: root.agentId, agentName: root.agentName };
      }
      for (const dependencyKey of workflowCollaborationKeys(manifest.data.workflowSnapshot)) {
        const dependency = byKey.get(dependencyKey);
        if (dependency) pending.push(dependency);
      }
    }
  }
  return null;
}

export function liveRunDependingOnAgent(
  versions: CollaborationVersionDependency[],
  rootVersionIds: ReadonlySet<string>,
  targetAgentId: string,
): { agentId: string; agentName: string } | null {
  const byKey = new Map(versions.map((version) => [`${version.agentId}:${version.versionId}`, version]));
  const roots = versions.filter((version) => rootVersionIds.has(version.versionId) && version.agentId !== targetAgentId);
  for (const root of roots) {
    const pending = dependencyKeys(root.manifest);
    const visited = new Set<string>();
    while (pending.length > 0) {
      const key = pending.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      const separator = key.lastIndexOf(":");
      if (key.slice(0, separator) === targetAgentId) {
        return { agentId: root.agentId, agentName: root.agentName };
      }
      const dependency = byKey.get(key);
      if (dependency) pending.push(...dependencyKeys(dependency.manifest));
    }
  }
  return null;
}

export function liveRunDependingOnKnowledgeSource(
  versions: CollaborationVersionDependency[],
  rootVersionIds: ReadonlySet<string>,
  targetSourceId: string,
): { agentId: string; agentName: string } | null {
  const byKey = new Map(versions.map((version) => [`${version.agentId}:${version.versionId}`, version]));
  const roots = versions.filter((version) => rootVersionIds.has(version.versionId));
  for (const root of roots) {
    const pending = [root];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      const key = `${current.agentId}:${current.versionId}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const manifest = AgentManifest.safeParse(current.manifest);
      if (!manifest.success) continue;
      if (manifest.data.knowledgeSnapshot.includes(targetSourceId)) {
        return { agentId: root.agentId, agentName: root.agentName };
      }
      for (const dependencyKey of workflowCollaborationKeys(manifest.data.workflowSnapshot)) {
        const dependency = byKey.get(dependencyKey);
        if (dependency) pending.push(dependency);
      }
    }
  }
  return null;
}
