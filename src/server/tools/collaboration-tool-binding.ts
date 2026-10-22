import { AgentManifest } from "@/contracts/manifest";
import type { inspectCollaborationVersionGraph } from "@/server/domain/runtime/collaboration-dependencies";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { workflowToolRegistrationIssue } from "./tool-binding";

type Dependency = Parameters<typeof inspectCollaborationVersionGraph>[0]["versions"][number];

export function collaborationToolRegistrationIssue(
  versions: readonly Dependency[],
  requiredVersionIds: readonly string[],
  getRegistration: Parameters<typeof workflowToolRegistrationIssue>[1],
): string | null {
  const required = new Set(requiredVersionIds), selected = new Map<string, Dependency>();
  for (const version of versions) {
    if (!required.has(version.versionId)) continue;
    if (selected.has(version.versionId)) return "协作助手的冻结版本归属不明确，不能确认工具配置";
    selected.set(version.versionId, version);
  }
  for (const id of required) {
    const version = selected.get(id);
    const manifest = version && version.agentArchivedAt === null ? AgentManifest.safeParse(version.manifest) : null;
    if (!version || !manifest?.success) return "协作助手的冻结版本缺失、已停用或格式无效，不能确认工具配置";
    const issue = workflowToolRegistrationIssue(manifest.data.workflowSnapshot, getRegistration);
    if (issue) return redactSensitiveText(`协作助手「${version.agentName}」的${issue}`);
  }
  return null;
}
