"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { AgentTargetOption } from "@/contracts/agent";
import type { KnowledgeSourceView } from "@/contracts/knowledge";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { NODE_TYPE_LABELS, workflowNodeTypes, type WorkflowFlowNode } from "./CustomNodes";
import { autoLayout } from "./layout";
import { NodeInspector } from "./NodeInspector";
import { applyConnection, clearEdge, outgoingSpecs, removeNode, type EdgeKind } from "./flow-edges";
import { updateWorkflowNode } from "./update-workflow-node";
import { ADDABLE_NODE_TYPES, createWorkflowNode } from "./create-workflow-node";
import { WorkflowInputEditor } from "./WorkflowInputEditor";
import { WorkflowOutputEditor } from "./WorkflowOutputEditor";
import { validateOutputFieldPaths } from "@/server/domain/runtime/output-contract";
import { notifyDraftState } from "@/lib/draft-state";
import { readSessionValue, removeSessionValue, writeSessionValue } from "@/lib/session-storage";
import { draftRecoveryKey, restoreDraftRecovery, serializeDraftRecovery } from "./draft-recovery";

interface FlowCanvasProps {
  agentId: string;
  draft: WorkflowDraft;
  draftUpdatedAt: string | null;
  agentTargets: AgentTargetOption[];
  toolOptions: ToolRegistryOption[];
  knowledgeSources: KnowledgeSourceView[];
}

const EDGE_STYLES: Record<EdgeKind, { color: string; dashed: boolean }> = {
  next: { color: "#6b7280", dashed: false },
  reject: { color: "#dc2626", dashed: true },
  error: { color: "#ea580c", dashed: true },
  branch: { color: "#2563eb", dashed: false },
  body: { color: "#7c3aed", dashed: true },
  timeout: { color: "#0891b2", dashed: true },
};

export function FlowCanvas({ agentId, draft: initialDraft, draftUpdatedAt, agentTargets, toolOptions, knowledgeSources }: FlowCanvasProps) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [savedDraft, setSavedDraft] = useState(initialDraft);
  const [showControlNodes, setShowControlNodes] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedRevision, setSavedRevision] = useState(draftUpdatedAt);
  const [newNodeType, setNewNodeType] = useState<(typeof ADDABLE_NODE_TYPES)[number] | "">("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const markDirty = useCallback(() => {
    setDirty(true);
    setFeedback(null);
  }, []);

  useEffect(() => notifyDraftState({ agentId, dirty }), [agentId, dirty]);
  useEffect(() => () => notifyDraftState({ agentId, dirty: false }), [agentId]);
  useEffect(() => {
    const key = draftRecoveryKey(agentId);
    const raw = readSessionValue(key);
    const recovered = restoreDraftRecovery(raw, initialDraft);
    if (!recovered) {
      if (raw) removeSessionValue(key);
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setDraft(recovered);
      setDirty(true);
      setFeedback({ ok: true, text: "已恢复本标签页中未保存的流程修改" });
    });
    return () => {
      active = false;
    };
  }, [agentId, initialDraft]);
  useEffect(() => {
    if (!dirty) return;
    writeSessionValue(draftRecoveryKey(agentId), serializeDraftRecovery(savedDraft, draft));
  }, [agentId, dirty, draft, savedDraft]);
  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty]);

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
    if (changes.some((change) => change.type === "position" && change.position)) markDirty();
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
  }, [markDirty]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some((change) => change.type === "remove")) markDirty();
    setDraft((current) => {
      let next = current;
      for (const change of changes) {
        if (change.type === "remove") next = clearEdge(next, change.id);
      }
      return next;
    });
  }, [markDirty]);

  const onConnect = useCallback((connection: Connection) => {
    markDirty();
    setDraft((current) => applyConnection(current, connection));
  }, [markDirty]);

  const handleNodeChange = useCallback((node: WorkflowNode) => {
    markDirty();
    setDraft((current) => updateWorkflowNode(current, node.id, node));
  }, [markDirty]);

  const handleNodeDelete = useCallback((nodeId: string) => {
    markDirty();
    setDraft((current) => removeNode(current, nodeId));
    setSelectedId((current) => (current === nodeId ? null : current));
  }, [markDirty]);

  const handleNodeAdd = useCallback(() => {
    if (!newNodeType) return;
    markDirty();
    setDraft((current) => {
      const created = createWorkflowNode(current, newNodeType);
      setSelectedId(created.nodeId);
      return created.draft;
    });
    setNewNodeType("");
  }, [markDirty, newNodeType]);

  async function handleSave() {
    const names = draft.variables.map((variable) => variable.name);
    if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) || new Set(names).size !== names.length) {
      setFeedback({ ok: false, text: "运行输入字段名必须以字母或下划线开头，且不能重复" });
      return;
    }
    const outputFields = draft.outputContract?.fields ?? [];
    if (outputFields.some((field) => !field.sourceNodeId || !draft.nodes[field.sourceNodeId])) {
      setFeedback({ ok: false, text: "最终交付字段必须选择有效来源" });
      return;
    }
    const outputPathError = validateOutputFieldPaths(outputFields);
    if (outputPathError) {
      setFeedback({ ok: false, text: outputPathError });
      return;
    }
    setPending(true);
    setFeedback(null);
    try {
      const result = await saveWorkflowAction(agentId, draft, savedRevision);
      if (result.ok) {
        setFeedback({ ok: true, text: "草稿已保存" });
        setSavedRevision(result.updatedAt);
        setSavedDraft(draft);
        setDirty(false);
        removeSessionValue(draftRecoveryKey(agentId));
        router.refresh();
      } else {
        setFeedback({ ok: false, text: result.error });
      }
    } catch {
      setFeedback({ ok: false, text: "保存失败，请检查网络后重试" });
    } finally {
      setPending(false);
    }
  }

  function discardLocalChanges() {
    if (!window.confirm("确定放弃本标签页中所有未保存的流程修改吗？")) return;
    removeSessionValue(draftRecoveryKey(agentId));
    setDraft(savedDraft);
    setSelectedId(null);
    setDirty(false);
    setFeedback({ ok: true, text: "已恢复到最近一次保存的流程" });
  }

  const selectedNode = selectedId ? (visibleNodes.find((node) => node.id === selectedId) ?? null) : null;

  return (
    <section className="flex flex-col gap-3">
      <WorkflowInputEditor variables={draft.variables} onChange={(variables) => {
        markDirty();
        setDraft((current) => ({ ...current, variables }));
      }} />
      <WorkflowOutputEditor nodes={draft.nodes} fields={draft.outputContract?.fields ?? []}
        onChange={(fields) => {
          markDirty();
          setDraft((current) => ({ ...current, outputContract: { fields } }));
        }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showControlNodes}
            onChange={(event) => setShowControlNodes(event.target.checked)}
          />
          显示控制节点
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            新增步骤
            <select
              aria-label="新增步骤类型"
              value={newNodeType}
              onChange={(event) => setNewNodeType(event.target.value as (typeof ADDABLE_NODE_TYPES)[number] | "")}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">选择类型</option>
              {ADDABLE_NODE_TYPES.map((type) => <option key={type} value={type}>{NODE_TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={!newNodeType}
            onClick={handleNodeAdd}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-500 disabled:text-gray-400"
          >
            添加
          </button>
          {feedback ? (
            <span role={feedback.ok ? "status" : "alert"} className={feedback.ok ? "text-sm text-emerald-600" : "text-sm text-red-600"}>
              {feedback.text}
            </span>
          ) : null}
          {dirty && !feedback ? <span role="status" className="text-sm text-amber-700">有未保存修改</span> : null}
          {dirty ? <button type="button" disabled={pending} onClick={discardLocalChanges}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-gray-500 disabled:text-gray-400">
            放弃修改
          </button> : null}
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
            <NodeInspector key={selectedNode.id} node={selectedNode} workflowNodes={draft.nodes} agentTargets={agentTargets} toolOptions={toolOptions} knowledgeSources={knowledgeSources} onNodeChange={handleNodeChange} onNodeDelete={handleNodeDelete} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
