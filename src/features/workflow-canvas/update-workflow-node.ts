import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";

export function updateWorkflowNode(draft: WorkflowDraft, nodeId: string, node: WorkflowNode): WorkflowDraft {
  const previous = draft.nodes[nodeId];
  if (!previous || previous.title === node.title) {
    return { ...draft, nodes: { ...draft.nodes, [nodeId]: node } };
  }
  const updated =
    node.type === "knowledge" && node.knowledge?.query === previous.title
      ? { ...node, knowledge: { ...node.knowledge, query: node.title } }
      : node;
  const uniqueTitle = Object.values(draft.nodes).filter((item) => item.title === previous.title).length === 1;
  const nodes = Object.fromEntries(
    Object.entries(draft.nodes).map(([id, current]) => {
      const next = id === nodeId ? updated : current;
      const quality = next.quality;
      if (!uniqueTitle || !quality) return [id, next];
      return [id, {
        ...next,
        quality: {
          ...quality,
          requiredOutputTitles: quality.requiredOutputTitles.map((title) =>
            title === previous.title ? node.title : title,
          ),
        },
      }];
    }),
  );
  const outputContract = draft.outputContract ? {
    fields: draft.outputContract.fields.map((field) => {
      const sourceId = field.sourceNodeId ?? field.path.split(".")[0];
      return sourceId === nodeId && field.label === previous.title
        ? { ...field, label: node.title }
        : field;
    }),
  } : undefined;
  return { ...draft, nodes, ...(outputContract ? { outputContract } : {}) };
}
