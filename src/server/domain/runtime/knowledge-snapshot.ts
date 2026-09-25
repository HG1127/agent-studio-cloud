import type { WorkflowNode } from "@/contracts/workflow";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function collectKnowledgeTitles(node: Record<string, unknown>, titles: string[]): void {
  if (node.type === "knowledge") titles.push(typeof node.title === "string" && node.title.trim() ? node.title.trim() : "读取知识资料");
  const subflow = asRecord(node.subflow);
  if (Array.isArray(subflow?.steps)) {
    for (const step of subflow.steps) {
      const record = asRecord(step);
      if (record) collectKnowledgeTitles(record, titles);
    }
  }
  const parallel = asRecord(node.parallel);
  if (Array.isArray(parallel?.branches)) {
    for (const branch of parallel.branches) {
      const record = asRecord(branch);
      if (!Array.isArray(record?.steps)) continue;
      for (const step of record.steps) {
        const child = asRecord(step);
        if (child) collectKnowledgeTitles(child, titles);
      }
    }
  }
}

export function knowledgeStepTitles(nodes: Record<string, WorkflowNode>): string[] {
  const titles: string[] = [];
  for (const node of Object.values(nodes)) collectKnowledgeTitles(node, titles);
  return [...new Set(titles)];
}

export function validateKnowledgeSnapshot(args: {
  knowledgeTitles: string[];
  snapshotSourceIds: string[];
  availableSourceIds: ReadonlySet<string>;
}): string | null {
  if (args.knowledgeTitles.length === 0) return null;
  const available = args.snapshotSourceIds.some((sourceId) => args.availableSourceIds.has(sourceId));
  if (available) return null;
  const titles = args.knowledgeTitles.slice(0, 3).map((title) => `「${title}」`).join("、");
  return `${titles}需要知识资料，但这个版本的发布快照中没有可用资料；请恢复资料，或上传后重新发布`;
}
