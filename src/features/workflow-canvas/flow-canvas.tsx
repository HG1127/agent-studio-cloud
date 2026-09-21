"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { workflowNodeTypes, type WorkflowFlowNode } from "./custom-nodes";
import { autoLayout } from "./layout";
import { NodeInspector } from "./node-inspector";

interface FlowCanvasProps {
  agentId: string;
  draft: WorkflowDraft;
}

type EdgeKind = "next" | "reject" | "error" | "branch" | "body";

const EDGE_STYLES: Record<EdgeKind, { color: string; dashed: boolean }> = {
  next: { color: "#6b7280", dashed: false },
  reject: { color: "#dc2626", dashed: true },
  error: { color: "#ea580c", dashed: true },
  branch: { color: "#2563eb", dashed: false },
  body: { color: "#7c3aed", dashed: true },
};

// 出边规格与草稿字段一一对应，句柄 id 同时用于连线与删边时回写
interface EdgeSpec {
  handle: string;
  target: string;
  kind: EdgeKind;
  label?: string;
}

function outgoingSpecs(node: WorkflowNode): EdgeSpec[] {
  const specs: EdgeSpec[] = [];
  if (node.rejectNext) specs.push({ handle: "reject", target: node.rejectNext, kind: "reject", label: "不通过" });
  if (node.onErrorNext) specs.push({ handle: "error", target: node.onErrorNext, kind: "error", label: "未完成时" });
  if (node.type === "condition") {
    node.condition?.branches.forEach((branch, index) => {
      if (branch.next) {
        specs.push({ handle: `branch-${index}`, target: branch.next, kind: "branch", label: branch.label || "满足" });
      }
    });
    if (node.condition?.defaultNext) {
      specs.push({ handle: "default", target: node.condition.defaultNext, kind: "branch", label: "否则" });
    }
  }
  if (node.type === "loop") {
    if (node.loop?.bodyNext) specs.push({ handle: "body", target: node.loop.bodyNext, kind: "body", label: "逐项处理" });
    if (node.loop?.exitNext) specs.push({ handle: "exit", target: node.loop.exitNext, kind: "next", label: "完成" });
  }
  if (node.next) specs.push({ handle: "next", target: node.next, kind: "next" });
  return specs;
}

function patchNode(draft: WorkflowDraft, nodeId: string, node: WorkflowNode): WorkflowDraft {
  return { ...draft, nodes: { ...draft.nodes, [nodeId]: node } };
}

function isStructuralNode(node: WorkflowNode | undefined): boolean {
  return !node || node.type === "trigger" || node.type === "end";
}

// 删除节点时同步清理所有指向它的引用，避免悬空目标
function removeNode(draft: WorkflowDraft, nodeId: string): WorkflowDraft {
  if (isStructuralNode(draft.nodes[nodeId]) || draft.startNodeId === nodeId) return draft;
  const nodes: Record<string, WorkflowNode> = {};
  for (const [id, node] of Object.entries(draft.nodes)) {
    if (id === nodeId) continue;
    const cleaned: WorkflowNode = {
      ...node,
      next: node.next === nodeId ? null : node.next,
      rejectNext: node.rejectNext === nodeId ? null : node.rejectNext,
      onErrorNext: node.onErrorNext === nodeId ? null : node.onErrorNext,
    };
    if (node.condition) {
      cleaned.condition = {
        ...node.condition,
        branches: node.condition.branches.map((branch) =>
          branch.next === nodeId ? { ...branch, next: null } : branch,
        ),
        defaultNext: node.condition.defaultNext === nodeId ? null : node.condition.defaultNext,
      };
    }
    if (node.loop) {
      cleaned.loop = {
        ...node.loop,
        bodyNext: node.loop.bodyNext === nodeId ? null : node.loop.bodyNext,
        exitNext: node.loop.exitNext === nodeId ? null : node.loop.exitNext,
      };
    }
    nodes[id] = cleaned;
  }
  const positions = { ...draft.ui.positions };
  delete positions[nodeId];
  return { ...draft, nodes, ui: { ...draft.ui, positions } };
}

// 连线回写：句柄决定写到哪个字段
function applyConnection(draft: WorkflowDraft, connection: Connection): WorkflowDraft {
  const { source, target, sourceHandle } = connection;
  if (!source || !target || source === target || !draft.nodes[source] || !draft.nodes[target]) return draft;
  const node = draft.nodes[source];
  if (sourceHandle === "reject") return patchNode(draft, source, { ...node, rejectNext: target });
  if (sourceHandle === "error") return patchNode(draft, source, { ...node, onErrorNext: target });
  if (sourceHandle === "default") {
    const condition = node.condition ?? { source: null, operator: "eq" as const, branches: [], defaultNext: null };
    return patchNode(draft, source, { ...node, condition: { ...condition, defaultNext: target } });
  }
  if (sourceHandle === "body" || sourceHandle === "exit") {
    if (!node.loop) return draft;
    const loop = { ...node.loop };
    if (sourceHandle === "body") loop.bodyNext = target;
    else loop.exitNext = target;
    return patchNode(draft, source, { ...node, loop });
  }
  if (sourceHandle?.startsWith("branch-")) {
    if (!node.condition) return draft;
    const index = Number(sourceHandle.slice("branch-".length));
    if (!Number.isInteger(index) || index < 0 || index >= node.condition.branches.length) return draft;
    return patchNode(draft, source, {
      ...node,
      condition: {
        ...node.condition,
        branches: node.condition.branches.map((branch, i) => (i === index ? { ...branch, next: target } : branch)),
      },
    });
  }
  return patchNode(draft, source, { ...node, next: target });
}

// 删边回写：只有当字段当前仍指向该目标时才清空，避免误伤改线后的新值
function clearEdge(draft: WorkflowDraft, edgeId: string): WorkflowDraft {
  const parts = edgeId.split("~");
  if (parts.length !== 3) return draft;
  const [source, handle, target] = parts;
  const node = draft.nodes[source];
  if (!node) return draft;
  if (handle === "reject") {
    return node.rejectNext === target ? patchNode(draft, source, { ...node, rejectNext: null }) : draft;
  }
  if (handle === "error") {
    return node.onErrorNext === target ? patchNode(draft, source, { ...node, onErrorNext: null }) : draft;
  }
  if (handle === "default" && node.condition) {
    return node.condition.defaultNext === target
      ? patchNode(draft, source, { ...node, condition: { ...node.condition, defaultNext: null } })
      : draft;
  }
  if ((handle === "body" || handle === "exit") && node.loop) {
    if (handle === "body" ? node.loop.bodyNext !== target : node.loop.exitNext !== target) return draft;
    const loop = { ...node.loop };
    if (handle === "body") loop.bodyNext = null;
    else loop.exitNext = null;
    return patchNode(draft, source, { ...node, loop });
  }
  if (handle.startsWith("branch-") && node.condition) {
    const index = Number(handle.slice("branch-".length));
    if (!Number.isInteger(index) || index < 0 || index >= node.condition.branches.length) return draft;
    if (node.condition.branches[index].next !== target) return draft;
    return patchNode(draft, source, {
      ...node,
      condition: {
        ...node.condition,
        branches: node.condition.branches.map((branch, i) => (i === index ? { ...branch, next: null } : branch)),
      },
    });
  }
  return node.next === target ? patchNode(draft, source, { ...node, next: null }) : draft;
}

export function FlowCanvas({ agentId, draft: initialDraft }: FlowCanvasProps) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [showControlNodes, setShowControlNodes] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const visibleNodes = useMemo(
    () => Object.values(draft.nodes).filter((node) => showControlNodes || node.ui?.visibility !== "control"),
    [draft.nodes, showControlNodes],
  );
  const layoutPositions = useMemo(() => autoLayout(draft), [draft]);

  const flowNodes: WorkflowFlowNode[] = useMemo(
    () =>
      visibleNodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: draft.ui.positions[node.id] ?? layoutPositions[node.id] ?? { x: 0, y: 0 },
        data: { node },
        deletable: false,
      })),
    [visibleNodes, draft.ui.positions, layoutPositions],
  );

  const flowEdges: Edge[] = useMemo(() => {
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    return visibleNodes.flatMap((node) =>
      outgoingSpecs(node)
        .filter((spec) => visibleIds.has(spec.target))
        .map((spec) => {
          const style = EDGE_STYLES[spec.kind];
          return {
            id: `${node.id}~${spec.handle}~${spec.target}`,
            source: node.id,
            target: spec.target,
            sourceHandle: spec.handle,
            targetHandle: "in",
            label: spec.label,
            style: {
              stroke: style.color,
              strokeWidth: 1.5,
              ...(style.dashed ? { strokeDasharray: "6 4" } : {}),
            },
            labelStyle: { fill: "#4b5563", fontSize: 12 },
            labelBgStyle: { fill: "#ffffff" },
          } satisfies Edge;
        }),
    );
  }, [visibleNodes]);

  const onNodesChange = useCallback((changes: NodeChange<WorkflowFlowNode>[]) => {
    setDraft((current) => {
      let next = current;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          next = {
            ...next,
            ui: {
              ...next.ui,
              positions: {
                ...next.ui.positions,
                [change.id]: { x: change.position.x, y: change.position.y },
              },
            },
          };
        }
      }
      return next;
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setDraft((current) => {
      let next = current;
      for (const change of changes) {
        if (change.type === "remove") next = clearEdge(next, change.id);
      }
      return next;
    });
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    setDraft((current) => applyConnection(current, connection));
  }, []);

  const handleNodeChange = useCallback((node: WorkflowNode) => {
    setDraft((current) => patchNode(current, node.id, node));
  }, []);

  const handleNodeDelete = useCallback((nodeId: string) => {
    setDraft((current) => removeNode(current, nodeId));
    setSelectedId((current) => (current === nodeId ? null : current));
  }, []);

  async function handleSave() {
    setPending(true);
    setFeedback(null);
    const result = await saveWorkflowAction(agentId, draft);
    if (result.ok) {
      setFeedback({ ok: true, text: "草稿已保存" });
      router.refresh();
    } else {
      setFeedback({ ok: false, text: result.error });
    }
    setPending(false);
  }

  const selectedNode = selectedId ? (visibleNodes.find((node) => node.id === selectedId) ?? null) : null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showControlNodes}
            onChange={(event) => setShowControlNodes(event.target.checked)}
          />
          显示控制节点
        </label>
        <div className="flex items-center gap-3">
          {feedback ? (
            <span role={feedback.ok ? "status" : "alert"} className={feedback.ok ? "text-sm text-emerald-600" : "text-sm text-red-600"}>
              {feedback.text}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-400"
          >
            {pending ? "正在保存…" : "保存"}
          </button>
        </div>
      </div>
      <div className="flex items-stretch gap-4">
        <div className="h-[560px] flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={workflowNodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        {selectedNode ? (
          <div className="w-72 shrink-0">
            <NodeInspector node={selectedNode} onNodeChange={handleNodeChange} onNodeDelete={handleNodeDelete} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
