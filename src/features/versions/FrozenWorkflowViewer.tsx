"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Background, Handle, Position, ReactFlow, type NodeChange, type NodeProps, type NodeTypes, type ReactFlowInstance, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LockKeyhole, Maximize2, Search, ZoomIn, ZoomOut } from "lucide-react";
import type { WorkflowDraft } from "@/contracts/workflow";
import type { AgentManifest } from "@/contracts/manifest";
import { InputSourcePath } from "@/contracts/input-mapping";
import { outputSourceOptions } from "@/features/workflow-canvas/workflow-output-editing";
import { validateOutputContract } from "@/server/domain/runtime/output-contract";
import { NODE_TYPE_LABELS, type WorkflowFlowNode, type WorkflowFlowNodeData } from "@/features/workflow-canvas/CustomNodes";
import { outgoingSpecs } from "@/features/workflow-canvas/flow-edges";
import { canvasSelectedId } from "@/features/workflow-canvas/canvas-selection";
import { useCanvasViewShortcuts } from "@/features/workflow-canvas/use-canvas-view-shortcuts";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { frozenStep, frozenWorkflowGraph } from "./frozen-workflow-view";
import { FrozenNodeDetails } from "./FrozenNodeDetails";
import { FrozenResourceBindings } from "./FrozenResourceBindings";
import type { FrozenResourceBindingsView } from "./frozen-resource-bindings";

function FrozenNode(props: NodeProps) {
  const node = (props.data as WorkflowFlowNodeData).node;
  const routes = outgoingSpecs(node);
  return <div className={`h-28 w-[220px] rounded-xl border bg-white p-3 shadow-sm ${props.selected ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200"}`}>
    <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
    {routes.map((route, index) => <Handle key={route.handle} id={route.handle} type="source" position={Position.Right} isConnectable={false} style={{ top: ((index + 1) / (routes.length + 1)) * 100 + "%" }} />)}
    <p className="flex items-center gap-1.5 text-xs text-slate-500"><LockKeyhole aria-hidden="true" className="size-3" />{NODE_TYPE_LABELS[node.type]}{isHiddenControlNode(node) ? " · 系统检查" : ""}</p>
    <p className="mt-2 line-clamp-2 break-words text-sm font-semibold leading-5 text-slate-900">{node.title || "未命名步骤"}</p>
    {node.description ? <p className="mt-1 line-clamp-1 text-xs text-slate-500">{node.description}</p> : null}
  </div>;
}
const nodeTypes: NodeTypes = { frozen: FrozenNode };
const FIELD_TYPES = { string: "文字", number: "数字", boolean: "是或否", object: "对象", array: "列表" } as const;

export function FrozenWorkflowViewer({ workflow, input, output, resources }: {
  workflow: WorkflowDraft; input: AgentManifest["inputContract"]; output: AgentManifest["outputContract"];
  resources?: FrozenResourceBindingsView;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(frozenStep(workflow, workflow.startNodeId) ? workflow.startNodeId : null);
  const [query, setQuery] = useState("");
  const [arrange, setArrange] = useState(false);
  const flow = useRef<ReactFlowInstance<WorkflowFlowNode, Edge> | null>(null);
  const canvasContainer = useRef<HTMLDivElement>(null);
  const { onCanvasRef, onViewInit, onViewKeyDown, canvasMounted, viewError } = useCanvasViewShortcuts(workflow, canvasContainer, flow);
  const selectedIdRef = useRef(selectedId);
  const workflowRef = useRef(workflow);
  useLayoutEffect(() => { selectedIdRef.current = selectedId; workflowRef.current = workflow; }, [selectedId, workflow]);
  const detailsContainer = useRef<HTMLDivElement>(null);
  const focusDetails = useRef(false);
  const graph = useMemo(() => frozenWorkflowGraph(workflow, arrange), [workflow, arrange]);
  const outputSources = useMemo(() => outputSourceOptions(workflow.nodes), [workflow.nodes]);
  const nodes = useMemo(() => graph.nodes.map((node) => ({ ...node, selected: node.id === selectedId, ariaLabel: (node.data.node.title || "未命名步骤") + "，只读冻结步骤" })), [graph.nodes, selectedId]);
  const selected = selectedId ? frozenStep(workflow, selectedId) : null;
  const allNodes = Object.values(workflow.nodes);
  const savedPositions = allNodes.filter((node) => workflow.ui.positions[node.id]).length;
  const matching = allNodes.filter((node) => !query.trim() || [node.title, node.description].some((text) => text?.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN"))));
  useEffect(() => {
    if (focusDetails.current) detailsContainer.current?.querySelector<HTMLElement>("#frozen-node-title")?.focus();
    focusDetails.current = false;
  }, [selectedId]);
  function select(id: string, moveFocus = false) {
    if (!frozenStep(workflow, id)) return;
    if (moveFocus && selectedId === id) detailsContainer.current?.querySelector<HTMLElement>("#frozen-node-title")?.focus();
    else focusDetails.current = moveFocus;
    selectedIdRef.current = id;
    setSelectedId(id);
    const position = graph.nodes.find((node) => node.id === id)?.position;
    if (position) void flow.current?.setCenter(position.x + 110, position.y + 56, { zoom: 1, duration: 250 });
  }
  function onNodesChange(changes: NodeChange<WorkflowFlowNode>[]) {
    if (workflowRef.current !== workflow || !changes.some((change) => change.type === "select")) return;
    const nextId = canvasSelectedId(selectedIdRef.current, changes, Object.values(workflowRef.current.nodes));
    selectedIdRef.current = nextId;
    focusDetails.current = false;
    setSelectedId(nextId);
  }
  return <div className="space-y-4">
    <section aria-labelledby="frozen-canvas-title" className="content-card min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="frozen-canvas-title" className="section-title">已冻结的流程</h2><p className="mt-1 text-xs leading-5 text-slate-500">保存 {allNodes.length} 个顶层步骤，包含 {allNodes.filter(isHiddenControlNode).length} 个系统检查步骤。组内步骤在详情核对，数量不是实际执行次数。</p></div><div className="flex flex-wrap gap-2">
        {savedPositions ? <button type="button" onClick={() => { setArrange((current) => !current); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">{arrange ? "返回快照布局" : "整理查看布局"}</button>
          : <span aria-label="快照布局说明" className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">没有保存的步骤位置</span>}
        <button type="button" onClick={() => void flow.current?.fitView({ padding: 0.15, duration: 250 })} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"><Maximize2 aria-hidden="true" className="size-3.5" />适应画布</button><button type="button" aria-label="放大只读画布" onClick={() => void flow.current?.zoomIn()} className="rounded-lg border border-slate-200 p-2"><ZoomIn aria-hidden="true" className="size-4" /></button><button type="button" aria-label="缩小只读画布" onClick={() => void flow.current?.zoomOut()} className="rounded-lg border border-slate-200 p-2"><ZoomOut aria-hidden="true" className="size-4" /></button></div></div>
      <p className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-950">只可查看、选择和平移缩放，不能拖动步骤、连线、删除、保存、发布或运行。整理布局仅影响本页查看；所有已保存路径可见，不按图上位置推断执行顺序或运行经过。</p>
      {savedPositions < allNodes.length ? <p className="mt-2 text-xs leading-5 text-slate-500">{savedPositions ? `已保存 ${savedPositions} 个步骤的位置，其余位置按保存路径临时计算。` : "快照没有保存步骤位置；当前按已保存路径临时计算布局，不写入坐标。"}</p> : null}
      {graph.startMissing ? <p role="alert" className="mt-3 text-sm text-amber-900">没有找到已保存的流程起点；仍显示现存步骤，不自行选择替代起点。</p> : null}
      {graph.missingRoutes ? <p role="alert" className="mt-3 text-sm text-amber-900">有 {graph.missingRoutes} 条已保存路径未找到目标步骤，未画成有效连线。请结合步骤设置核对。</p> : null}
      <p id="frozen-canvas-keyboard-help" className="mt-2 text-xs leading-5 text-slate-500">聚焦画布后，用 + 或 = 放大、- 缩小、0 适应画布；也支持配合控制键或命令键使用。聚焦步骤后按回车或空格核对冻结设置，不修改流程。</p>
      {viewError ? <p role="status" className="mt-2 text-xs leading-5 text-amber-800">{viewError}</p> : null}
      {allNodes.length ? <div ref={onCanvasRef} aria-label="冻结流程只读画布" aria-describedby="frozen-canvas-keyboard-help" tabIndex={0} onKeyDown={onViewKeyDown} className="relative mt-4 h-[440px] min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        {canvasMounted ? <ReactFlow<WorkflowFlowNode, Edge> nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes} onInit={onViewInit}
          onNodesChange={onNodesChange} onNodeClick={(_event, node) => { selectedIdRef.current = node.id; setSelectedId(node.id); }} onPaneClick={() => { selectedIdRef.current = null; setSelectedId(null); }}
          nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} connectOnClick={false}
          edgesFocusable={false} minZoom={0.15} maxZoom={1.6} fitView fitViewOptions={{ padding: 0.15 }}
          ariaLabelConfig={{ "node.a11yDescription.default": "只读步骤，按回车或空格核对冻结设置，也可使用下方步骤列表。", "edge.a11yDescription.default": "已保存路径，只读不可编辑。" }}>
          <Background color="#e2e8f0" gap={20} />
        </ReactFlow> : <p role="status" className="p-4 text-sm text-slate-500">正在准备冻结流程画布…</p>}
      </div> : <p role="status" className="mt-4 rounded-lg border border-dashed border-slate-200 p-5 text-sm text-slate-500">这个冻结快照没有保存顶层步骤；不从当前草稿补造流程。</p>}
    </section>
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(16rem,0.65fr)_minmax(0,1.35fr)]">
      <section aria-labelledby="frozen-step-list-title" className="content-card min-w-0 self-start"><h2 id="frozen-step-list-title" className="section-title">查找冻结步骤</h2><label className="mt-3 block"><span className="text-xs font-medium text-slate-600">按保存的名称或说明查找</span><div className="relative mt-1"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" /><input type="search" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></div></label><p className="mt-2 text-xs leading-5 text-slate-500">当前匹配 {matching.length} 个顶层步骤，只筛选列表，不隐藏流程或改变已选步骤。</p>
        {matching.length ? <ul aria-label="冻结步骤列表" className="mt-3 max-h-96 space-y-2 overflow-auto">{matching.map((node) => <li key={node.id}><button type="button" aria-pressed={selectedId === node.id} onClick={() => select(node.id)} className={`w-full rounded-lg border px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-indigo-500 ${selectedId === node.id ? "border-indigo-300 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}><span className="block break-words text-sm font-semibold text-slate-800">{node.title || "未命名步骤"}</span><span className="mt-1 block text-xs text-slate-500">{NODE_TYPE_LABELS[node.type]}{isHiddenControlNode(node) ? " · 系统检查" : ""}</span></button></li>)}</ul> : <div className="mt-3 rounded-lg bg-slate-50 p-3"><p role="status" className="text-sm text-slate-500">{query ? "没有匹配的冻结步骤，不表示流程为空。" : "没有可核对的顶层步骤。"}</p>{query ? <button type="button" onClick={() => setQuery("")} className="mt-2 text-xs font-semibold text-indigo-700">清除步骤查找</button> : null}</div>}
      </section>
      <div ref={detailsContainer} className="min-w-0">{selected ? <FrozenNodeDetails key={selected.id} node={selected} workflow={workflow} onSelect={(id) => select(id, true)} /> : <section className="content-card flex min-h-64 items-center justify-center"><p role="status" className="text-sm leading-6 text-slate-500">从只读画布或步骤列表选择一项，核对冻结设置。</p></section>}</div>
    </div>
    {resources ? <FrozenResourceBindings view={resources} collapsible onLocateStep={(ownerNodeId) => {
      if (!frozenStep(workflow, ownerNodeId)) throw new Error("Frozen resource owner unavailable");
      select(ownerNodeId, true);
    }} /> : null}
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <section aria-labelledby="frozen-input-title" className="content-card min-w-0"><h2 id="frozen-input-title" className="section-title">冻结的业务输入约定</h2>{input.fields.length ? <ul className="mt-3 divide-y divide-slate-100">{input.fields.map((field, index) => <li key={field.name} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="break-words text-slate-800">{field.label?.trim() || "输入 " + (index + 1)}</span><span className="text-xs text-slate-500">{FIELD_TYPES[field.type]} · {field.required ? "必填" : "选填"}</span></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">没有保存结构化输入字段，不生成试填字段。</p>}</section>
      <section aria-labelledby="frozen-output-title" className="content-card min-w-0">
        <h2 id="frozen-output-title" className="section-title">冻结的最终交付约定</h2>
        {output?.fields.length ? <ul aria-label="冻结交付字段列表" className="mt-3 divide-y divide-slate-100">{output.fields.map((field, index) => {
          const source = outputSources.find((option) => option.node.id === field.sourceNodeId);
          const sourcePath = InputSourcePath.safeParse(field.sourcePath ?? []);
          const issue = field.sourceNodeId ? validateOutputContract([field], workflow.nodes) : null;
          return <li key={index} className="space-y-2 py-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><span className="break-words text-slate-800">{field.label?.trim() || "交付 " + (index + 1)}</span><span className="text-xs text-slate-500">{field.required ? "需要交付" : "可选交付"}</span></div>
            {source ? <><button type="button" onClick={() => select(source.ownerId, true)} className="text-left text-xs font-semibold text-indigo-700">定位来源：{source.label || "未命名步骤"}</button>{source.ownerId !== source.node.id ? <p className="text-xs leading-5 text-slate-500">定位到所属画布步骤，组内设置按已保存名称核对；这不是实际执行记录。</p> : null}</>
              : <p className="text-xs text-slate-500">{field.sourceNodeId ? "已保存来源关联，但未找到对应步骤。" : "未保存来源步骤关联，不从字段路径猜测。"}</p>}
            {!sourcePath.success || issue ? <p className="text-xs leading-5 text-amber-800">保存的来源取值约定无法按当前规则核对；保留原定义，不补造有效来源或子字段。</p>
              : sourcePath.data.length ? <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <p className="font-medium text-slate-700">取值：指定来源子字段</p>
                <ol aria-label={`交付 ${index + 1} 冻结来源层级`} className="mt-2 space-y-1 text-slate-600">{sourcePath.data.map((segment, position) => <li key={position} className="break-words">第 {position + 1} 层：{segment}</li>)}</ol>
                <p className="mt-2 leading-5 text-slate-500">每层是完整字段原名，点不拆分，列表位置从零开始。按本冻结约定读取，不代表来源已实际产出，也不保证未来结果结构。</p>
              </div> : <p className="text-xs text-slate-600">取值：整个步骤结果。不从交付位置推测子字段。</p>}
          </li>;
        })}</ul> : <p className="mt-3 text-sm text-slate-500">没有保存结构化交付字段，不生成结果占位。</p>}
      </section>
    </div>
  </div>;
}
