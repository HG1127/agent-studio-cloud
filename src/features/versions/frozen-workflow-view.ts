import type { Edge } from "@xyflow/react";
import { MAX_WORKFLOW_BYTES, WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { isPassiveJsonData } from "@/contracts/json";
import { AgentInputContract, type AgentManifest } from "@/contracts/manifest";
import { redactSensitiveData } from "@/server/domain/security/redact-sensitive";
import { autoLayout } from "@/features/workflow-canvas/layout";
import { outgoingSpecs, type EdgeKind } from "@/features/workflow-canvas/flow-edges";
import type { WorkflowFlowNode } from "@/features/workflow-canvas/CustomNodes";

export function frozenWorkflowView(workflow: WorkflowDraft, rawWorkflow: unknown = workflow): WorkflowDraft {
  if (!isPassiveJsonData(rawWorkflow, MAX_WORKFLOW_BYTES)) throw new Error("Unsafe frozen workflow");
  const original = WorkflowDraft.parse(rawWorkflow);
  if (JSON.stringify(original) !== JSON.stringify(WorkflowDraft.parse(workflow))) throw new Error("Frozen source mismatch");
  const rawNodes = (rawWorkflow as WorkflowDraft).nodes;
  const safeRoot = redactSensitiveData({ ...workflow, nodes: {}, ui: { positions: {} } }) as Record<string, unknown>;
  // 节点和位置字典的键是结构标识，不是凭据字段。
  const view = WorkflowDraft.parse({ ...safeRoot, nodes: Object.fromEntries(Object.entries(workflow.nodes)
    .map(([id, node]) => [id, WorkflowNode.parse(redactSensitiveData(node))])), ui: workflow.ui });
  for (const [id, node] of Object.entries(view.nodes)) {
    const saved = redactSensitiveData(rawNodes[id]) as WorkflowNode;
    // 只读约定保留原快照的缺省和未知字段，不能把解析默认值说成当时已保存。
    if (Object.hasOwn(saved, "modelOutput")) node.modelOutput = saved.modelOutput;
    else delete node.modelOutput;
    if (Object.hasOwn(saved, "inputMapping")) node.inputMapping = saved.inputMapping;
    else delete node.inputMapping;
    if (Object.hasOwn(saved, "toolOperation")) node.toolOperation = saved.toolOperation;
    else delete node.toolOperation;
    if (Object.hasOwn(saved, "quality")) node.quality = saved.quality;
    else delete node.quality;
    if (Object.hasOwn(saved, "retry")) node.retry = saved.retry;
    else delete node.retry;
  }
  return view;
}
export function frozenInputView(input: AgentManifest["inputContract"]): AgentManifest["inputContract"] {
  return AgentInputContract.parse(redactSensitiveData(input));
}
export function frozenOutputView(output: AgentManifest["outputContract"]): AgentManifest["outputContract"] {
  return WorkflowDraft.shape.outputContract.parse(redactSensitiveData(output));
}
const EDGE_COLORS: Record<EdgeKind, string> = { next: "#64748b", reject: "#dc2626", error: "#ea580c", branch: "#2563eb", body: "#7c3aed", timeout: "#0891b2" };
export function frozenStep(workflow: WorkflowDraft, id: string): WorkflowNode | null {
  return Object.hasOwn(workflow.nodes, id) ? workflow.nodes[id] : null;
}
export function frozenWorkflowGraph(workflow: WorkflowDraft, arrange: boolean) {
  // 失效路径不能把对象的继承属性误当作已保存步骤。
  const layoutNodes = Object.assign(Object.create(null) as WorkflowDraft["nodes"], workflow.nodes);
  const layout = autoLayout({ ...workflow, nodes: layoutNodes });
  const nodes: WorkflowFlowNode[] = Object.values(workflow.nodes).map((node) => ({
    id: node.id, type: "frozen", data: { node }, position: !arrange && workflow.ui.positions[node.id] ? workflow.ui.positions[node.id] : layout[node.id],
    draggable: false, connectable: false, deletable: false,
  }));
  const edges: Edge[] = [];
  let missingRoutes = 0;
  for (const node of Object.values(workflow.nodes)) for (const route of outgoingSpecs(node)) {
    if (!frozenStep(workflow, route.target)) { missingRoutes++; continue; }
    edges.push({ id: `${node.id}:${route.handle}:${route.target}`, source: node.id, target: route.target, sourceHandle: route.handle, targetHandle: "in",
      label: route.label ?? "完成后", type: "smoothstep", reconnectable: false, deletable: false,
      style: { stroke: EDGE_COLORS[route.kind], strokeWidth: 1.7, ...(route.kind === "next" || route.kind === "branch" ? {} : { strokeDasharray: "5 4" }) },
      labelStyle: { fontSize: 11, fill: "#475569" }, labelBgStyle: { fill: "#f8fafc" },
    });
  }
  return { nodes, edges, missingRoutes, startMissing: !frozenStep(workflow, workflow.startNodeId) };
}
