"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Download, Eye, EyeOff, Maximize2, Minimize2, PlugZap, Plus, Redo2, RotateCcw, Save, Undo2, WandSparkles, Workflow } from "lucide-react";
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AgentTargetOption } from "@/contracts/agent";
import type { KnowledgeSourceView } from "@/contracts/knowledge";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import { MAX_WORKFLOW_NODES, type WorkflowDraft, type WorkflowNode } from "@/contracts/workflow";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { NODE_TYPE_LABELS, workflowNodeTypes, type WorkflowFlowNode } from "./CustomNodes";
import { autoLayout } from "./layout";
import { NodeInspector } from "./NodeInspector";
import { applyConnection, clearEdge, connectionReplacesHiddenControl, editableRouteSlots, linearDeletionContinuation, outgoingSpecs, removeNode, visibleOutgoingSpecs, type EdgeKind } from "./flow-edges";
import { updateWorkflowNode } from "./update-workflow-node";
import { ADDABLE_NODE_TYPES, canAddWorkflowNode, createWorkflowNode, insertWorkflowNodeAfter } from "./create-workflow-node";
import { WorkflowInputEditor } from "./WorkflowInputEditor";
import { WorkflowOutputEditor } from "./WorkflowOutputEditor";
import { validateOutputFieldPaths } from "@/server/domain/runtime/output-contract";
import { notifyDraftState } from "@/lib/draft-state";
import { readSessionValue, removeSessionValue, writeSessionValue } from "@/lib/session-storage";
import { draftRecoveryKey, draftsEquivalent, readDraftRecoveryCopy, restoreDraftRecovery, serializeDraftRecovery } from "./draft-recovery";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { workflowStepGuide } from "./workflow-step-guide";
import { WORKFLOW_NODE_FOCUS_EVENT, type WorkflowNodeFocusDetail } from "@/lib/workflow-node-focus";
import { recordedBusinessObjective } from "./business-evidence";
import { canMoveLinearStep, moveLinearStep, type MoveDirection } from "./move-workflow-step";
import { changeWorkflowNodeType, type ChangeableNodeType } from "./change-workflow-node-type";
import { canvasIssues } from "./canvas-issues";
import { canvasToolBindingSummary } from "./tool-binding-status";

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
const MAX_UNDO_STEPS = 40;

export function FlowCanvas({ agentId, draft: initialDraft, draftUpdatedAt, agentTargets, toolOptions, knowledgeSources }: FlowCanvasProps) {
  const router = useRouter();
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const exitFullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<WorkflowFlowNode, Edge> | null>(null);
  const pendingSaveRef = useRef<{ draft: WorkflowDraft; expectedUpdatedAt: string | null } | null>(null);
  const savingRef = useRef(false);
  const recoveredAgentRef = useRef<string | null>(null);
  const [draft, setDraft] = useState(initialDraft);
  const [savedDraft, setSavedDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  const savedDraftRef = useRef(initialDraft);
  const dragStartDraftRef = useRef<WorkflowDraft | null>(null);
  const draggedNodeIdsRef = useRef<Set<string>>(new Set());
  const completedDragNodeIdsRef = useRef<Set<string> | null>(null);
  const historyRef = useRef<{ past: WorkflowDraft[]; future: WorkflowDraft[] }>({ past: [], future: [] });
  const [history, setHistory] = useState<{ past: WorkflowDraft[]; future: WorkflowDraft[] }>({ past: [], future: [] });
  const [showControlNodes, setShowControlNodes] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodeSearch, setNodeSearch] = useState("");
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertainSave, setUncertainSave] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedRevision, setSavedRevision] = useState(draftUpdatedAt);
  const [newNodeType, setNewNodeType] = useState<(typeof ADDABLE_NODE_TYPES)[number] | "">("");
  const [insertAfterId, setInsertAfterId] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingTypeChange, setPendingTypeChange] = useState<{ nodeId: string; targetType: ChangeableNodeType } | null>(null);
  const [recoveryConflict, setRecoveryConflict] = useState<Record<string, unknown> | null>(null);
  const [clearRecoveryOpen, setClearRecoveryOpen] = useState(false);
  const [recoveryDownloadError, setRecoveryDownloadError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"steps" | "canvas">("steps");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [wideCanvas, setWideCanvas] = useState(false);
  const nodeLimitReached = !canAddWorkflowNode(draft);
  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedId(nodeId);
    if (nodeId) setInsertAfterId(draftRef.current.nodes[nodeId]?.type === "end" ? "" : nodeId);
  }, []);
  const recordUndoSnapshot = useCallback((previous: WorkflowDraft) => {
    historyRef.current = {
      past: [...historyRef.current.past, previous].slice(-MAX_UNDO_STEPS),
      future: [],
    };
    setHistory(historyRef.current);
  }, []);
  const applyLocalDraft = useCallback((next: WorkflowDraft, recordHistory = true) => {
    const previous = draftRef.current;
    if (draftsEquivalent(previous, next)) return false;
    if (recordHistory) recordUndoSnapshot(previous);
    draftRef.current = next;
    setDraft(next);
    const hasChanges = !draftsEquivalent(next, savedDraftRef.current);
    setDirty(hasChanges);
    if (!hasChanges && !pendingSaveRef.current) removeSessionValue(draftRecoveryKey(agentId));
    setFeedback(null);
    return true;
  }, [agentId, recordUndoSnapshot]);
  const undoDraft = useCallback(() => {
    if (pending || uncertainSave || historyRef.current.past.length === 0) return;
    const previous = historyRef.current.past.at(-1)!;
    historyRef.current = {
      past: historyRef.current.past.slice(0, -1),
      future: [...historyRef.current.future, draftRef.current].slice(-MAX_UNDO_STEPS),
    };
    setHistory(historyRef.current);
    applyLocalDraft(previous, false);
    setFeedback({ ok: true, text: "已撤销上一步修改" });
  }, [applyLocalDraft, pending, uncertainSave]);
  const redoDraft = useCallback(() => {
    if (pending || uncertainSave || historyRef.current.future.length === 0) return;
    const next = historyRef.current.future.at(-1)!;
    historyRef.current = {
      past: [...historyRef.current.past, draftRef.current].slice(-MAX_UNDO_STEPS),
      future: historyRef.current.future.slice(0, -1),
    };
    setHistory(historyRef.current);
    applyLocalDraft(next, false);
    setFeedback({ ok: true, text: "已恢复上一步修改" });
  }, [applyLocalDraft, pending, uncertainSave]);
  const onHistoryKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    if (key === "y" || (key === "z" && event.shiftKey)) redoDraft();
    else undoDraft();
  }, [redoDraft, undoDraft]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return;
      event.preventDefault();
      if (selectedId) {
        setSelectedId(null);
        exitFullscreenButtonRef.current?.focus();
      } else {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [isFullscreen, selectedId]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        void flowInstanceRef.current?.fitView({ padding: 0.18, maxZoom: 1, duration: 300 });
      });
    });
    return () => {
      document.body.style.overflow = previous;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [isFullscreen]);

  useEffect(() => notifyDraftState({ agentId, dirty }), [agentId, dirty]);
  useEffect(() => () => notifyDraftState({ agentId, dirty: false }), [agentId]);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const sync = () => setWideCanvas(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (isFullscreen || wideCanvas || mobileView !== "canvas") return;
    canvasContainerRef.current?.scrollIntoView?.({ block: "start" });
  }, [isFullscreen, mobileView, wideCanvas]);
  useEffect(() => {
    if (recoveredAgentRef.current === agentId) return;
    const key = draftRecoveryKey(agentId);
    const raw = readSessionValue(key);
    const recovered = restoreDraftRecovery(raw, initialDraft);
    if (!recovered) {
      const localCopy = readDraftRecoveryCopy(raw);
      if (localCopy) {
        let active = true;
        queueMicrotask(() => { if (active) setRecoveryConflict(localCopy); });
        recoveredAgentRef.current = agentId;
        return () => { active = false; };
      }
      if (raw) removeSessionValue(key);
      recoveredAgentRef.current = agentId;
      return;
    }
    if (draftsEquivalent(recovered, initialDraft)) {
      removeSessionValue(key);
      recoveredAgentRef.current = agentId;
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      recoveredAgentRef.current = agentId;
      draftRef.current = recovered;
      historyRef.current = { past: [initialDraft], future: [] };
      setHistory(historyRef.current);
      setDraft(recovered);
      setDirty(true);
      setFeedback({ ok: true, text: "已恢复本标签页中未保存的流程修改" });
    });
    return () => {
      active = false;
    };
  }, [agentId, initialDraft]);
  useEffect(() => {
    if (dirty || pending || uncertainSave || recoveryConflict) return;
    const incomingRevision = draftUpdatedAt ? Date.parse(draftUpdatedAt) : Number.NEGATIVE_INFINITY;
    const localRevision = savedRevision ? Date.parse(savedRevision) : Number.NEGATIVE_INFINITY;
    if (!Number.isFinite(incomingRevision) || incomingRevision <= localRevision) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      draftRef.current = initialDraft;
      savedDraftRef.current = initialDraft;
      historyRef.current = { past: [], future: [] };
      setHistory(historyRef.current);
      setDraft(initialDraft);
      setSavedDraft(initialDraft);
      setSavedRevision(draftUpdatedAt);
      setSelectedId(null);
      setInsertAfterId("");
    });
    return () => { active = false; };
  }, [draftUpdatedAt, initialDraft, savedRevision, dirty, pending, uncertainSave, recoveryConflict]);
  useEffect(() => {
    if (!dirty) return;
    writeSessionValue(draftRecoveryKey(agentId), serializeDraftRecovery(savedDraft, draft, uncertainSave ? pendingSaveRef.current?.draft : null));
  }, [agentId, dirty, draft, savedDraft, uncertainSave]);
  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty]);
  const focusNode = useCallback((nodeId: string) => {
    if (recoveryConflict) return;
    const node = draft.nodes[nodeId];
    if (!node) {
      setFeedback({ ok: false, text: "这个问题对应的步骤已不在当前流程中。请保存修改并刷新设计检查。" });
      return;
    }
    document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (isHiddenControlNode(node)) setShowControlNodes(true);
    selectNode(node.id);
    setFocusNodeId(wideCanvas ? node.id : null);
    if (!wideCanvas) setMobileView("steps");
  }, [draft.nodes, recoveryConflict, selectNode, wideCanvas]);
  useEffect(() => {
    const focus = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowNodeFocusDetail>).detail;
      if (detail?.agentId === agentId) focusNode(detail.nodeId);
    };
    window.addEventListener(WORKFLOW_NODE_FOCUS_EVENT, focus);
    return () => window.removeEventListener(WORKFLOW_NODE_FOCUS_EVENT, focus);
  }, [agentId, focusNode]);

  const visibleNodes = useMemo(
    () => Object.values(draft.nodes).filter((node) => showControlNodes || !isHiddenControlNode(node)),
    [draft.nodes, showControlNodes],
  );
  const hiddenControlCount = useMemo(
    () => Object.values(draft.nodes).filter(isHiddenControlNode).length,
    [draft.nodes],
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  useEffect(() => {
    if (!focusNodeId || !visibleIds.has(focusNodeId)) return;
    const frame = window.requestAnimationFrame(() => {
      void flowInstanceRef.current?.fitView({ nodes: [{ id: focusNodeId }], padding: 0.5, maxZoom: 1, duration: 350 });
      setFocusNodeId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusNodeId, visibleIds]);
  const layoutPositions = useMemo(() => autoLayout(draft, visibleIds), [draft, visibleIds]);
  const stepGuide = useMemo(() => workflowStepGuide(draft, showControlNodes), [draft, showControlNodes]);
  const localIssues = useMemo(() => canvasIssues(draft, toolOptions), [draft, toolOptions]);
  const toolBindingSummary = useMemo(() => canvasToolBindingSummary(draft, toolOptions), [draft, toolOptions]);
  const validInsertAfterId = insertAfterId && stepGuide.some(({ node }) => node.id === insertAfterId && node.type !== "end") ? insertAfterId : "";
  const matchingNodes = useMemo(() => {
    const term = nodeSearch.trim().toLocaleLowerCase("zh-CN");
    return Object.values(draft.nodes).filter((node) => !term || `${node.title} ${node.description ?? ""}`.toLocaleLowerCase("zh-CN").includes(term));
  }, [draft.nodes, nodeSearch]);

  const flowNodes: WorkflowFlowNode[] = useMemo(
    () =>
      visibleNodes.map((node) => ({
        id: node.id,
        type: node.type,
        selected: node.id === selectedId,
        position: draft.ui.positions[node.id] ?? layoutPositions[node.id] ?? { x: 0, y: 0 },
        data: { node },
        deletable: false,
      })),
    [visibleNodes, draft.ui.positions, layoutPositions, selectedId],
  );

  const flowEdges: Edge[] = useMemo(() => {
    return visibleNodes.flatMap((node) =>
      (showControlNodes
        ? outgoingSpecs(node).map((spec) => ({ ...spec, directTarget: spec.target, collapsed: false }))
        : visibleOutgoingSpecs(node, draft.nodes, visibleIds))
        .filter((spec) => visibleIds.has(spec.target))
        .map((spec) => {
          const style = EDGE_STYLES[spec.kind];
          return {
            id: spec.collapsed
              ? `${node.id}~${spec.handle}~${spec.directTarget}~${spec.target}`
              : `${node.id}~${spec.handle}~${spec.target}`,
            source: node.id,
            target: spec.target,
            sourceHandle: spec.handle,
            targetHandle: "in",
            label: spec.label,
            deletable: !spec.collapsed,
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
  }, [draft.nodes, showControlNodes, visibleIds, visibleNodes]);

  const onNodesChange = useCallback((changes: NodeChange<WorkflowFlowNode>[]) => {
    let next = draftRef.current;
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        if (dragStartDraftRef.current) draggedNodeIdsRef.current.add(change.id);
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
    const finalDragPosition = completedDragNodeIdsRef.current !== null
      && changes.length > 0
      && changes.every((change) => change.type === "position" && change.dragging === false && completedDragNodeIdsRef.current?.has(change.id));
    completedDragNodeIdsRef.current = null;
    applyLocalDraft(next, dragStartDraftRef.current === null && !finalDragPosition);
  }, [applyLocalDraft]);

  const onNodeDragStart = useCallback(() => {
    dragStartDraftRef.current = draftRef.current;
    draggedNodeIdsRef.current = new Set();
    completedDragNodeIdsRef.current = null;
  }, []);
  const onNodeDragStop = useCallback(() => {
    const before = dragStartDraftRef.current;
    dragStartDraftRef.current = null;
    if (before && !draftsEquivalent(before, draftRef.current)) {
      recordUndoSnapshot(before);
      completedDragNodeIdsRef.current = draggedNodeIdsRef.current;
    }
  }, [recordUndoSnapshot]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    let next = draftRef.current;
    for (const change of changes) {
      if (change.type === "remove") next = clearEdge(next, change.id);
    }
    applyLocalDraft(next);
  }, [applyLocalDraft]);

  const onConnect = useCallback((connection: Connection) => {
    if (!showControlNodes && connectionReplacesHiddenControl(draftRef.current, connection)) {
      setFeedback({ ok: false, text: "这条连线包含隐藏的安全检查，请先显示控制节点再修改" });
      return;
    }
    applyLocalDraft(applyConnection(draftRef.current, connection));
  }, [applyLocalDraft, showControlNodes]);

  const handleRouteChange = useCallback((nodeId: string, handle: string, targetId: string | null) => {
    const currentDraft = draftRef.current;
    const source = currentDraft.nodes[nodeId];
    const slot = source ? editableRouteSlots(source).find((candidate) => candidate.handle === handle) : null;
    if (!slot || (targetId && !slot.editable)) return;
    if (!showControlNodes && isHiddenControlNode(source)) {
      setFeedback({ ok: false, text: "请先显示控制节点，再修改这条控制路径" });
      return;
    }
    if (!showControlNodes && slot.target && isHiddenControlNode(currentDraft.nodes[slot.target])) {
      setFeedback({ ok: false, text: "这条路径经过隐藏的控制检查，请先显示控制节点再修改" });
      return;
    }
    if (targetId) {
      const target = currentDraft.nodes[targetId];
      if (!target || target.id === nodeId || target.type === "trigger" || (!showControlNodes && isHiddenControlNode(target))) {
        setFeedback({ ok: false, text: "请选择另一个可用步骤作为目标" });
        return;
      }
    }
    if (slot.target === targetId) return;
    const next = targetId
      ? applyConnection(currentDraft, { source: nodeId, target: targetId, sourceHandle: handle, targetHandle: "in" })
      : slot.target ? clearEdge(currentDraft, `${nodeId}~${handle}~${slot.target}`) : currentDraft;
    if (next === currentDraft) return;
    applyLocalDraft(next);
    setFeedback({ ok: true, text: targetId ? "已调整后续路径，保存草稿后生效；可撤销" : "已断开这条路径，保存草稿后生效；可撤销" });
  }, [applyLocalDraft, showControlNodes]);

  const handleIncomingDisconnect = useCallback((sourceId: string, handle: string, targetId: string) => {
    const source = draftRef.current.nodes[sourceId];
    const currentTarget = source && editableRouteSlots(source).find((slot) => slot.handle === handle)?.target;
    if (currentTarget !== targetId) {
      setFeedback({ ok: false, text: "这条路径已经变化，请重新查看后再操作" });
      return;
    }
    handleRouteChange(sourceId, handle, null);
  }, [handleRouteChange]);

  const requestNodeTypeChange = useCallback((nodeId: string, targetType: ChangeableNodeType) => {
    const preview = changeWorkflowNodeType(draftRef.current, nodeId, targetType);
    if ("error" in preview) {
      setFeedback({ ok: false, text: preview.error });
      return;
    }
    setPendingTypeChange({ nodeId, targetType });
  }, []);

  const confirmNodeTypeChange = useCallback(() => {
    if (!pendingTypeChange) return;
    const result = changeWorkflowNodeType(draftRef.current, pendingTypeChange.nodeId, pendingTypeChange.targetType);
    setPendingTypeChange(null);
    if ("error" in result) {
      setFeedback({ ok: false, text: result.error });
      return;
    }
    applyLocalDraft(result.draft);
    setFeedback({ ok: true, text: `已改为“${NODE_TYPE_LABELS[pendingTypeChange.targetType]}”，请检查新设置；保存草稿后生效，可撤销` });
  }, [applyLocalDraft, pendingTypeChange]);

  const handleNodeChange = useCallback((node: WorkflowNode) => {
    applyLocalDraft(updateWorkflowNode(draftRef.current, node.id, node));
  }, [applyLocalDraft]);

  const handleNodeDelete = useCallback((nodeId: string) => {
    const continuationId = linearDeletionContinuation(draftRef.current, nodeId);
    const continuationTitle = continuationId ? draftRef.current.nodes[continuationId].title : null;
    applyLocalDraft(removeNode(draftRef.current, nodeId));
    setSelectedId((current) => (current === nodeId ? null : current));
    setInsertAfterId((current) => (current === nodeId ? "" : current));
    setFeedback({ ok: true, text: continuationTitle
      ? `已删除步骤，前后路径已接续到“${continuationTitle}”；保存草稿后生效，可撤销`
      : "已删除步骤，相关路径可能断开；请检查并重新连线。保存草稿后生效，可撤销" });
  }, [applyLocalDraft]);

  const handleMoveNode = useCallback((nodeId: string, direction: MoveDirection) => {
    const result = moveLinearStep(draftRef.current, nodeId, direction);
    if ("error" in result) {
      setFeedback({ ok: false, text: result.error });
      return;
    }
    applyLocalDraft(result.draft);
    setFeedback({ ok: true, text: "已调整步骤顺序，保存草稿后生效；可撤销" });
  }, [applyLocalDraft]);

  const handleNodeAdd = useCallback(() => {
    if (!newNodeType) return;
    if (!canAddWorkflowNode(draftRef.current)) {
      setFeedback({ ok: false, text: `流程步骤不能超过 ${MAX_WORKFLOW_NODES} 个` });
      return;
    }
    const created = validInsertAfterId
      ? insertWorkflowNodeAfter(draftRef.current, newNodeType, validInsertAfterId)
      : createWorkflowNode(draftRef.current, newNodeType);
    if ("error" in created) {
      setFeedback({ ok: false, text: created.error });
      return;
    }
    const nextDraft = validInsertAfterId
      ? { ...created.draft, ui: { ...created.draft.ui, positions: autoLayout(created.draft) } }
      : created.draft;
    applyLocalDraft(nextDraft);
    setSelectedId(created.nodeId);
    setInsertAfterId(created.nodeId);
    setNewNodeType("");
    setFeedback({ ok: true, text: validInsertAfterId ? "已插入到所选路径，保存草稿后生效" : "已添加独立步骤，请连接流程路径后保存" });
  }, [applyLocalDraft, newNodeType, validInsertAfterId]);

  const handleArrange = useCallback(() => {
    const current = draftRef.current;
    const arranged = { ...current, ui: { ...current.ui, positions: autoLayout(current) } };
    const changed = applyLocalDraft(arranged);
    setMobileView("canvas");
    setFeedback({ ok: true, text: changed ? "已整理画布位置，保存草稿后生效" : "画布位置已是当前布局" });
    window.requestAnimationFrame(() => {
      const focusId = selectedId && current.nodes[selectedId] ? selectedId : current.startNodeId;
      void flowInstanceRef.current?.fitView(wideCanvas
        ? { padding: 0.18, maxZoom: 1, duration: 350 }
        : { nodes: [{ id: focusId }], padding: 0.3, maxZoom: 0.9, duration: 350 });
    });
  }, [applyLocalDraft, selectedId, wideCanvas]);

  async function handleSave() {
    if (savingRef.current || pending || !dirty) return;
    const submittedDraft = pendingSaveRef.current?.draft ?? draftRef.current;
    const names = submittedDraft.variables.map((variable) => variable.name);
    if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) || new Set(names).size !== names.length) {
      setFeedback({ ok: false, text: "运行输入字段名必须以字母或下划线开头，且不能重复" });
      return;
    }
    const outputFields = submittedDraft.outputContract?.fields ?? [];
    if (outputFields.some((field) => !field.sourceNodeId || !submittedDraft.nodes[field.sourceNodeId])) {
      setFeedback({ ok: false, text: "最终交付字段必须选择有效来源" });
      return;
    }
    const outputPathError = validateOutputFieldPaths(outputFields);
    if (outputPathError) {
      setFeedback({ ok: false, text: outputPathError });
      return;
    }
    const saveRequest = pendingSaveRef.current ?? { draft: submittedDraft, expectedUpdatedAt: savedRevision };
    pendingSaveRef.current = saveRequest;
    savingRef.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const result = await saveWorkflowAction(agentId, saveRequest.draft, saveRequest.expectedUpdatedAt);
      if (result.ok) {
        pendingSaveRef.current = null;
        setUncertainSave(false);
        const hasNewerEdits = !draftsEquivalent(draftRef.current, submittedDraft);
        setFeedback({ ok: true, text: hasNewerEdits ? "提交时的草稿已保存；保存期间的新修改仍待保存" : "草稿已保存" });
        setSavedRevision(result.updatedAt);
        savedDraftRef.current = submittedDraft;
        setSavedDraft(submittedDraft);
        setDirty(hasNewerEdits);
        historyRef.current = { past: hasNewerEdits ? [submittedDraft] : [], future: [] };
        setHistory(historyRef.current);
        if (!hasNewerEdits) removeSessionValue(draftRecoveryKey(agentId));
        router.refresh();
      } else {
        pendingSaveRef.current = null;
        setUncertainSave(false);
        setFeedback({ ok: false, text: result.error });
      }
    } catch {
      setUncertainSave(true);
      setFeedback({ ok: false, text: "暂时无法确认是否保存成功。核对会重用上次提交的草稿；本页后续修改仍保留，等待下一次保存。" });
    } finally {
      savingRef.current = false;
      setPending(false);
    }
  }

  function onCanvasKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void handleSave();
      return;
    }
    onHistoryKeyDown(event);
  }

  function discardLocalChanges() {
    if (uncertainSave) return;
    removeSessionValue(draftRecoveryKey(agentId));
    draftRef.current = savedDraftRef.current;
    historyRef.current = { past: [], future: [] };
    setHistory(historyRef.current);
    dragStartDraftRef.current = null;
    completedDragNodeIdsRef.current = null;
    setDraft(savedDraftRef.current);
    setSelectedId(null);
    setInsertAfterId("");
    setDirty(false);
    setFeedback({ ok: true, text: "已恢复到最近一次保存的流程" });
  }

  function downloadRecoveryCopy() {
    if (!recoveryConflict) return;
    setRecoveryDownloadError(null);
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(recoveryConflict, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "流程-本地副本.json";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setRecoveryDownloadError("下载本地副本失败，请保留此标签页并稍后重试。");
    }
  }

  const selectedNode = selectedId ? (visibleNodes.find((node) => node.id === selectedId) ?? null) : null;
  const deletionContinuationId = selectedNode ? linearDeletionContinuation(draft, selectedNode.id) : null;
  const typeChangePreview = pendingTypeChange ? changeWorkflowNodeType(draft, pendingTypeChange.nodeId, pendingTypeChange.targetType) : null;
  const typeChangeDescription = typeChangePreview && !("error" in typeChangePreview)
    ? `会清除旧类型的专属设置和原业务依据，保留步骤名称、位置及主要后续路径。${typeChangePreview.droppedRoutes.length ? `将断开这些路径：${typeChangePreview.droppedRoutes.join("、")}。` : ""}${typeChangePreview.removedOutputFields.length ? `将移除这些交付字段：${typeChangePreview.removedOutputFields.join("、")}。` : ""}更改只留在当前草稿，可撤销；请核对新类型的设置后再保存。`
    : "流程草稿已变化，请关闭后重新选择处理类型。";

  if (recoveryConflict) {
    return <section aria-labelledby="workflow-recovery-title" className="content-card rounded-2xl border-amber-200 bg-amber-50/70">
      <div className="flex items-start gap-3"><CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" /><div className="min-w-0"><h2 id="workflow-recovery-title" className="text-base font-semibold text-amber-950">本地流程副本需要核对</h2><p className="mt-2 text-sm leading-6 text-amber-900">本标签页保留了未完成的修改，但云端版本可能已变化，或本地内容尚未符合保存规则。为避免覆盖云端新内容，系统没有自动套用，也没有删除副本。请先下载副本供对照，再决定是否清除提醒并编辑当前云端流程。</p></div></div>
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={downloadRecoveryCopy} className="inline-flex h-10 items-center gap-2 rounded-xl bg-amber-800 px-4 text-sm font-semibold text-white hover:bg-amber-900"><Download aria-hidden="true" className="size-4" />下载本地流程副本</button><button type="button" onClick={() => setClearRecoveryOpen(true)} className="inline-flex h-10 items-center rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-900 hover:bg-amber-100">清除本地副本并继续</button></div>
      {recoveryDownloadError ? <p role="alert" className="mt-3 text-sm text-red-700">{recoveryDownloadError}</p> : null}
      <ConfirmDialog open={clearRecoveryOpen} onOpenChange={setClearRecoveryOpen} title="清除本地流程副本？" description="这只会清除本标签页的旧副本，不会改动云端流程。请先下载备份；清除后无法再从本标签页找回。" confirmLabel="清除副本并继续" onConfirm={() => { removeSessionValue(draftRecoveryKey(agentId)); setRecoveryConflict(null); setClearRecoveryOpen(false); }} />
    </section>;
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="workflow-canvas-title" onKeyDown={onCanvasKeyDown}>
      <div className="content-card overflow-hidden p-0">
        <header className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Workflow className="size-5" /></span>
            <div>
              <h2 id="workflow-canvas-title" className="text-base font-bold text-slate-950">流程设计</h2>
              <p className="mt-1 text-sm text-slate-500">共 {Object.keys(draft.nodes).length} 个步骤。点击画布中的步骤，查看并调整它如何执行。</p>
            </div>
          </div>
          <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${dirty ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
            {dirty ? <RotateCcw className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
            {uncertainSave ? "保存结果待核对" : dirty ? "有未保存修改" : "草稿已保存"}
          </span>
        </header>
        <div className="grid gap-3 border-t border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-2 sm:p-4">
          <WorkflowInputEditor variables={draft.variables} onChange={(variables) => {
            applyLocalDraft({ ...draftRef.current, variables });
          }} />
          <WorkflowOutputEditor nodes={draft.nodes} fields={draft.outputContract?.fields ?? []}
            onChange={(fields) => {
              applyLocalDraft({ ...draftRef.current, outputContract: { fields } });
            }} />
        </div>
      </div>
      <div className="content-card flex flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex min-h-9 items-center gap-2 text-sm font-medium text-slate-600">
          <input
            type="checkbox"
            checked={showControlNodes}
            onChange={(event) => setShowControlNodes(event.target.checked)}
          />
          {showControlNodes ? <Eye className="size-4 text-indigo-600" /> : <EyeOff className="size-4" />}
          显示控制节点{hiddenControlCount > 0 ? `（${hiddenControlCount}）` : ""}
        </label>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="flex min-w-0 basis-full items-center gap-2 text-sm text-slate-600 sm:basis-auto">
            新增步骤
            <select
              aria-label="新增步骤类型"
              value={newNodeType}
              onChange={(event) => setNewNodeType(event.target.value as (typeof ADDABLE_NODE_TYPES)[number] | "")}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm sm:w-44"
            >
              <option value="">选择类型</option>
              {ADDABLE_NODE_TYPES.map((type) => <option key={type} value={type}>{NODE_TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 basis-full items-center gap-2 text-sm text-slate-600 sm:basis-auto">
            添加位置
            <select aria-label="新增步骤位置" value={validInsertAfterId} onChange={(event) => setInsertAfterId(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm sm:w-56">
              <option value="">独立步骤（稍后连线）</option>
              {stepGuide.filter(({ node }) => node.type !== "end").map(({ node }) => <option key={node.id} value={node.id}>
                {node.title}之后{node.type === "condition" ? " · 否则" : node.type === "loop" ? " · 完成" : ""}
              </option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={!newNodeType || nodeLimitReached}
            onClick={handleNodeAdd}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            <Plus className="size-4" />{validInsertAfterId ? "插入" : "添加"}
          </button>
          <button type="button" aria-label="撤销上一步修改" title="撤销上一步修改" disabled={pending || uncertainSave || history.past.length === 0} onClick={undoDraft}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:text-slate-400">
            <Undo2 className="size-4" />撤销
          </button>
          <button type="button" aria-label="重做上一步修改" title="重做上一步修改" disabled={pending || uncertainSave || history.future.length === 0} onClick={redoDraft}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:text-slate-400">
            <Redo2 className="size-4" />重做
          </button>
          <button type="button" aria-label="自动整理画布" title="按流程连接整理全部步骤的位置" onClick={handleArrange}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-slate-400">
            <WandSparkles className="size-4" />整理
          </button>
          <button type="button" aria-label="全屏编辑流程" title="展开流程画布，不改变草稿" onClick={() => { setMobileView("canvas"); setIsFullscreen(true); }}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-slate-400">
            <Maximize2 className="size-4" />全屏
          </button>
          {dirty ? <button type="button" disabled={pending || uncertainSave} onClick={() => setDiscardOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-600 hover:border-slate-400 disabled:text-slate-400">
            <RotateCcw className="size-4" />
            放弃修改
          </button> : null}
          <button
            type="button"
            onClick={handleSave}
            aria-keyshortcuts="Control+S Meta+S"
            title="保存草稿（Ctrl/⌘ + S）"
            disabled={pending || !dirty}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
          >
            <Save className="size-4" />{pending ? (uncertainSave ? "正在核对…" : "正在保存…") : uncertainSave ? "核对上次保存" : "保存草稿"}
          </button>
        </div>
      </div>
        {feedback || (dirty && !feedback) || nodeLimitReached ? <div className="border-t border-slate-100 pt-3">
          {nodeLimitReached ? <span role="status" className="text-sm text-amber-700">已达到 {MAX_WORKFLOW_NODES} 个步骤上限</span> : null}
          {feedback ? (
            <span role={feedback.ok ? "status" : "alert"} className={feedback.ok ? "text-sm text-emerald-600" : "text-sm text-red-600"}>
              {feedback.text}
            </span>
          ) : null}
          {dirty && !feedback ? <span role="status" className="text-sm text-amber-700">修改只保存在当前浏览器，保存草稿后才会写入系统。</span> : null}
        </div> : null}
      </div>
      {toolBindingSummary.total > 0 ? <section aria-label="业务工具绑定概况" className={`content-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${toolBindingSummary.unbound + toolBindingSummary.unavailable > 0 ? "border-amber-200 bg-amber-50/50" : ""}`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-indigo-700"><PlugZap className="size-4" /></span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">业务工具绑定</h3>
            <p className="mt-1 text-sm leading-6 text-slate-700">画布上 {toolBindingSummary.total} 个工具步骤：{toolBindingSummary.selected} 个已选择服务端工具、{toolBindingSummary.demo} 个演示工具、{toolBindingSummary.unbound} 个未绑定、{toolBindingSummary.unavailable} 个当前不可用。</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">演示工具不连接业务系统；已选择工具仍需通过保存后的设计检查和运行校验。</p>
            {toolOptions.length === 0 ? <p className="mt-1 text-xs text-amber-800">当前服务端没有配置可选的业务工具。</p> : null}
          </div>
        </div>
        {toolBindingSummary.firstAttentionId ? <button type="button" onClick={() => focusNode(toolBindingSummary.firstAttentionId!)}
          className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100">
          {toolBindingSummary.unavailable > 0 ? "查看不可用工具" : "处理未绑定工具"}
        </button> : null}
      </section> : null}
      <div className="content-card grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-end sm:p-4">
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">查找步骤
          <input aria-label="搜索流程步骤" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="输入步骤名称或说明"
            className="h-10 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">定位步骤
          <select aria-label="定位流程步骤" value="" disabled={matchingNodes.length === 0} onChange={(event) => focusNode(event.target.value)}
            className="h-10 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100">
            <option value="">{matchingNodes.length} 个步骤 · 选择并查看</option>
            {matchingNodes.map((node) => <option key={node.id} value={node.id}>{node.title} · {NODE_TYPE_LABELS[node.type]}</option>)}
          </select>
        </label>
        {nodeSearch.trim() && matchingNodes.length === 0 ? <p role="status" className="text-xs text-slate-500 sm:col-span-2">没有找到符合条件的步骤，请换个名称或说明试试。</p> : null}
        <details className="min-w-0 border-t border-slate-100 pt-3 sm:col-span-2">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            {localIssues.length > 0 ? `当前草稿有 ${localIssues.length} 项基础问题` : "当前草稿的基础连接检查未发现问题"}
          </summary>
          <div className="mt-3 space-y-2">
            {localIssues.length > 0 ? <ul className="max-h-56 space-y-1 overflow-y-auto">
              {localIssues.map((issue, index) => <li key={`${issue.nodeId}-${issue.message}-${index}`}>
                <button type="button" onClick={() => focusNode(issue.nodeId)} className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-amber-800 hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-indigo-500">
                  <span className="font-semibold">{draft.nodes[issue.nodeId]?.title ?? "待检查步骤"}</span>：{issue.message}
                </button>
              </li>)}
            </ul> : <p className="text-sm text-slate-500">这里没有发现基础连接问题。</p>}
            <p className="text-xs leading-5 text-slate-500">这里只根据当前草稿提示连接与部分必填设置。保存后请运行完整设计检查；这不是发布或运行的通过结论。</p>
          </div>
        </details>
      </div>
      <div className="grid grid-cols-2 rounded-xl border border-slate-200 bg-white p-1 xl:hidden" aria-label="流程查看方式">
        <button type="button" onClick={() => setMobileView("steps")} aria-pressed={mobileView === "steps"}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${mobileView === "steps" ? "bg-indigo-50 text-indigo-700" : "text-slate-500"}`}>步骤列表</button>
        <button type="button" onClick={() => setMobileView("canvas")} aria-pressed={mobileView === "canvas"}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${mobileView === "canvas" ? "bg-indigo-50 text-indigo-700" : "text-slate-500"}`}>流程画布</button>
      </div>
      <div aria-label={isFullscreen ? "全屏流程画布" : undefined}
        className={isFullscreen
          ? "fixed inset-0 z-40 grid min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden bg-slate-50 p-3 sm:p-5 xl:grid-cols-[minmax(0,1fr)_20rem]"
          : "grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]"}>
        {isFullscreen ? <header className="col-span-full flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">全屏编辑流程</p><p className="truncate text-xs text-slate-500">可拖动画布查看步骤；退出后仍保留未保存的修改。</p></div>
          <button ref={exitFullscreenButtonRef} type="button" aria-label="退出全屏编辑" onClick={() => setIsFullscreen(false)} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Minimize2 className="size-4" />退出</button>
        </header> : null}
        {mobileView === "steps" && !isFullscreen ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-slate-950">执行步骤</p>
            <p className="mt-1 text-xs text-slate-500">按流程连接查看；条件分支会择一执行，同时处理的工作会并行执行。点步骤可打开设置。</p>
          </div>
          <ol className="divide-y divide-slate-100">
            {stepGuide.map(({ node, reachable, routes, hasHiddenContinuation }, index) => {
              const businessObjective = recordedBusinessObjective(node);
              return <li key={node.id} className="px-4 py-3">
              <button type="button" onClick={() => selectNode(node.id)} className="flex w-full items-start gap-3 rounded-lg text-left hover:bg-slate-50">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold text-slate-900">{node.title}</span>
                  <span className="mt-0.5 block break-words text-xs text-slate-500">{NODE_TYPE_LABELS[node.type]}{node.description ? ` · ${node.description}` : ""}</span>
                  {businessObjective && businessObjective !== node.title && businessObjective !== node.description ? <span className="mt-1 block break-words text-xs leading-5 text-indigo-800">业务目标：{businessObjective}</span> : null}
                </span>
                <span aria-hidden className="mt-1 text-slate-300">›</span>
              </button>
              {!reachable ? <p className="ml-10 mt-2 text-xs font-medium text-amber-700">未连接到起点，运行时不会经过这一步</p> : null}
              {routes.length > 0 ? <ul className="ml-10 mt-2 space-y-1 border-l-2 border-indigo-100 pl-3 text-xs text-slate-600">
                {routes.map((route, routeIndex) => <li key={`${node.id}-${route.targetId}-${routeIndex}`} className="flex flex-wrap gap-x-1">
                  <span>{route.label}：</span>
                  {route.targetTitle ? <button type="button" onClick={() => selectNode(route.targetId)} className="text-left font-medium text-indigo-700 hover:underline">{route.targetTitle}</button>
                    : <strong className="font-medium text-red-700">目标步骤不存在</strong>}
                  {route.collapsed ? <span className="text-slate-400">经控制检查</span> : null}
                </li>)}
              </ul> : node.type !== "end" ? <p className="ml-10 mt-2 text-xs text-amber-700">{hasHiddenContinuation ? "后续路径包含隐藏的控制步骤，请显示控制节点检查" : "尚未连接后续步骤"}</p> : null}
            </li>;
            })}
          </ol>
        </div> : null}
        {wideCanvas || mobileView === "canvas" || isFullscreen ? <div ref={canvasContainerRef} className={isFullscreen
          ? "h-full min-h-0 min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          : "h-[500px] min-w-0 scroll-mt-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:h-[560px]"}>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            onInit={(instance) => { flowInstanceRef.current = instance; }}
            nodeTypes={workflowNodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => selectNode(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView={wideCanvas}
            fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
            minZoom={0.25}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div> : null}
        {selectedNode ? (
          <>
            <button type="button" aria-label="关闭节点详情" onClick={() => setSelectedId(null)} className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[1px] xl:hidden" />
            <div className={`fixed inset-x-3 bottom-3 top-20 z-50 overflow-y-auto rounded-2xl xl:inset-auto xl:z-auto xl:overflow-y-auto ${isFullscreen ? "xl:relative xl:top-auto xl:max-h-full" : "xl:sticky xl:top-28 xl:max-h-[calc(100vh-8rem)]"}`}>
              <NodeInspector key={selectedNode.id} node={selectedNode} workflowNodes={draft.nodes} agentTargets={agentTargets} toolOptions={toolOptions} knowledgeSources={knowledgeSources} onNodeChange={handleNodeChange} onNodeDelete={handleNodeDelete}
                onRequestTypeChange={(type) => requestNodeTypeChange(selectedNode.id, type)}
                showControlNodes={showControlNodes} onRouteChange={(handle, targetId) => handleRouteChange(selectedNode.id, handle, targetId)}
                onDisconnectIncoming={handleIncomingDisconnect}
                onRevealControlNodes={() => setShowControlNodes(true)} onFocusNode={focusNode}
                deletionContinuationTitle={deletionContinuationId ? draft.nodes[deletionContinuationId].title : null}
                canMoveUp={canMoveLinearStep(draft, selectedNode.id, "up")} canMoveDown={canMoveLinearStep(draft, selectedNode.id, "down")}
                onMoveUp={() => handleMoveNode(selectedNode.id, "up")} onMoveDown={() => handleMoveNode(selectedNode.id, "down")}
                onClose={() => setSelectedId(null)} />
            </div>
          </>
        ) : null}
      </div>
      <ConfirmDialog open={pendingTypeChange !== null} onOpenChange={(open) => { if (!open) setPendingTypeChange(null); }}
        title="更改这一步的处理类型？" description={typeChangeDescription} confirmLabel="确认更改" tone="warning" onConfirm={confirmNodeTypeChange} />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="放弃未保存的修改？"
        description="本标签页里尚未保存的流程、输入字段和交付字段都会恢复到最近一次保存的版本。"
        confirmLabel="放弃修改"
        onConfirm={() => {
          setDiscardOpen(false);
          discardLocalChanges();
        }}
      />
    </section>
  );
}
