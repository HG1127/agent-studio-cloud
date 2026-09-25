import type { WorkflowNode } from "@/contracts/workflow";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

type KnowledgeScope = { title: string; sourceIds: string[] };

function collectKnowledgeScopes(node: Record<string, unknown>, scopes: KnowledgeScope[]): void {
  if (node.type === "knowledge") {
    const knowledge = asRecord(node.knowledge);
    scopes.push({
      title: typeof node.title === "string" && node.title.trim() ? node.title.trim() : "读取知识资料",
      sourceIds: Array.isArray(knowledge?.sourceIds)
        ? knowledge.sourceIds.filter((value): value is string => typeof value === "string")
        : [],
    });
  }
  const subflow = asRecord(node.subflow);
  if (Array.isArray(subflow?.steps)) {
    for (const step of subflow.steps) {
      const record = asRecord(step);
      if (record) collectKnowledgeScopes(record, scopes);
    }
  }
  const parallel = asRecord(node.parallel);
  if (Array.isArray(parallel?.branches)) {
    for (const branch of parallel.branches) {
      const record = asRecord(branch);
      if (!Array.isArray(record?.steps)) continue;
      for (const step of record.steps) {
        const child = asRecord(step);
        if (child) collectKnowledgeScopes(child, scopes);
      }
    }
  }
}

export function knowledgeStepTitles(nodes: Record<string, WorkflowNode>): string[] {
  const scopes: KnowledgeScope[] = [];
  for (const node of Object.values(nodes)) collectKnowledgeScopes(node, scopes);
  return [...new Set(scopes.map((scope) => scope.title))];
}

export function prepareKnowledgeSnapshot(
  nodes: Record<string, WorkflowNode>,
  sourceIds: string[],
): { ok: true; sourceIds: string[] } | { ok: false; error: string } {
  const scopes: KnowledgeScope[] = [];
  for (const node of Object.values(nodes)) collectKnowledgeScopes(node, scopes);
  if (scopes.length === 0) return { ok: true, sourceIds: [] };
  const available = new Set(sourceIds);
  const requested = [...new Set(scopes.flatMap((scope) => scope.sourceIds))];
  const missingSelection = requested.find((sourceId) => !available.has(sourceId));
  if (missingSelection) {
    return { ok: false, error: "资料步骤选择了已归档或尚未完成解析的资料，请重新选择后再发布" };
  }
  const selected = scopes.some((scope) => scope.sourceIds.length === 0)
    ? [...available].sort()
    : requested.sort();
  if (selected.length > 0) return { ok: true, sourceIds: selected };
  const titles = [...new Set(scopes.map((scope) => scope.title))];
  return {
    ok: false,
    error: `${titles.slice(0, 3).map((title) => `「${title}」`).join("、")}需要知识资料；请先上传并完成解析后再发布`,
  };
}

export function validateKnowledgeSnapshot(args: {
  knowledgeTitles: string[];
  snapshotSourceIds: string[];
  availableSourceIds: ReadonlySet<string>;
}): string | null {
  if (args.knowledgeTitles.length === 0) return null;
  const unavailable = args.snapshotSourceIds.some((sourceId) => !args.availableSourceIds.has(sourceId));
  if (args.snapshotSourceIds.length > 0 && !unavailable) return null;
  const titles = args.knowledgeTitles.slice(0, 3).map((title) => `「${title}」`).join("、");
  return `${titles}需要知识资料，但这个版本的发布快照中没有可用资料；请恢复资料，或上传后重新发布`;
}

export function knowledgeSourceIdsForStep(snapshotSourceIds: string[], configuredSourceIds?: string[]): string[] {
  if (!configuredSourceIds?.length) return [...snapshotSourceIds];
  const configured = new Set(configuredSourceIds);
  return snapshotSourceIds.filter((sourceId) => configured.has(sourceId));
}
