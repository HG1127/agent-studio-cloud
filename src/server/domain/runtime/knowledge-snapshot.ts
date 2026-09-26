import type { WorkflowNode } from "@/contracts/workflow";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

type KnowledgeScope = { title: string; sourceIds: string[]; selectionRequired: boolean };

function collectKnowledgeScope(node: Record<string, unknown>, scopes: KnowledgeScope[]): void {
  if (node.type === "knowledge") {
    const knowledge = asRecord(node.knowledge);
    scopes.push({
      title: typeof node.title === "string" && node.title.trim() ? node.title.trim() : "读取知识资料",
      sourceIds: Array.isArray(knowledge?.sourceIds)
        ? knowledge.sourceIds.filter((value): value is string => typeof value === "string")
        : [],
      selectionRequired: knowledge?.selectionRequired === true,
    });
  }
}

function directNestedSteps(node: Record<string, unknown>): Record<string, unknown>[] {
  const subflow = asRecord(node.subflow);
  const subflowSteps = Array.isArray(subflow?.steps) ? subflow.steps.map(asRecord).filter((step) => step !== null) : [];
  const parallel = asRecord(node.parallel);
  const parallelSteps = Array.isArray(parallel?.branches)
    ? parallel.branches.flatMap((branch) => {
        const record = asRecord(branch);
        return Array.isArray(record?.steps) ? record.steps.map(asRecord).filter((step) => step !== null) : [];
      })
    : [];
  return [...subflowSteps, ...parallelSteps];
}

function collectWorkflowKnowledgeScopes(nodes: Record<string, WorkflowNode>): KnowledgeScope[] {
  const scopes: KnowledgeScope[] = [];
  for (const node of Object.values(nodes)) {
    collectKnowledgeScope(node, scopes);
    for (const step of directNestedSteps(node)) collectKnowledgeScope(step, scopes);
  }
  return scopes;
}

export function knowledgeStepTitles(nodes: Record<string, WorkflowNode>): string[] {
  const scopes = collectWorkflowKnowledgeScopes(nodes);
  return [...new Set(scopes.map((scope) => scope.title))];
}

export function workflowKnowledgeSourceIds(nodes: Record<string, WorkflowNode>): string[] {
  return [...new Set(collectWorkflowKnowledgeScopes(nodes).flatMap((scope) => scope.sourceIds))];
}

export function prepareKnowledgeSnapshot(
  nodes: Record<string, WorkflowNode>,
  sourceIds: string[],
): { ok: true; sourceIds: string[] } | { ok: false; error: string } {
  const scopes = collectWorkflowKnowledgeScopes(nodes);
  if (scopes.length === 0) return { ok: true, sourceIds: [] };
  if (scopes.some((scope) => scope.selectionRequired)) {
    return { ok: false, error: "导入流程中的资料范围需要重新选择后再发布" };
  }
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
