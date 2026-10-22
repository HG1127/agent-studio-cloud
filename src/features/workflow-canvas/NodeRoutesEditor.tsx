"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { WorkflowNode } from "@/contracts/workflow";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { NODE_TYPE_LABELS } from "./CustomNodes";
import { editableRouteSlots, outgoingSpecs } from "./flow-edges";

export function NodeRoutesEditor({ node, nodes, showControlNodes, onRouteChange, onDisconnectIncoming, onRevealControlNodes, onFocusNode }: {
  node: WorkflowNode;
  nodes: Record<string, WorkflowNode>;
  showControlNodes: boolean;
  onRouteChange: (handle: string, targetId: string | null) => void;
  onDisconnectIncoming: (sourceId: string, handle: string, targetId: string) => void;
  onRevealControlNodes: () => void;
  onFocusNode: (nodeId: string) => void;
}) {
  const [pendingIncoming, setPendingIncoming] = useState<{ sourceId: string; sourceTitle: string; handle: string; label: string } | null>(null);
  const slots = editableRouteSlots(node);
  const targets = Object.values(nodes).filter((candidate) => candidate.id !== node.id && candidate.type !== "trigger"
    && (showControlNodes || !isHiddenControlNode(candidate)));
  const incoming = Object.values(nodes).flatMap((source) => outgoingSpecs(source)
    .filter((route) => route.target === node.id)
    .map((route) => ({ source, handle: route.handle, label: route.label || "正常流转" })));
  const hiddenIncoming = incoming.filter(({ source }) => isHiddenControlNode(source) && !showControlNodes).length;

  return <section aria-label="步骤流转设置" className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
    <h3 className="text-sm font-semibold text-slate-900">下一步怎么走</h3>
    <p className="mt-1 text-xs leading-5 text-slate-600">选择目标会改变执行路径；修改只留在当前草稿，保存后才生效。</p>
    {slots.length > 0 ? <div className="mt-3 space-y-3">
      {slots.map((slot) => {
        const current = slot.target ? nodes[slot.target] : null;
        const hiddenTarget = current && isHiddenControlNode(current) && !showControlNodes;
        const currentInOptions = slot.editable && slot.target && targets.some((candidate) => candidate.id === slot.target);
        return <div key={slot.handle} className="rounded-lg border border-slate-200 bg-white p-2.5">
          <label className="block text-xs font-semibold text-slate-700" htmlFor={`route-${node.id}-${slot.handle}`}>{slot.label}</label>
          <select id={`route-${node.id}-${slot.handle}`} aria-label={`${slot.label}的目标步骤`}
            value={slot.target ?? ""} disabled={Boolean(hiddenTarget)}
            onChange={(event) => onRouteChange(slot.handle, event.target.value || null)}
            className="mt-1.5 h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500">
            <option value="">尚未连接</option>
            {slot.target && !currentInOptions ? <option value={slot.target}>{hiddenTarget ? "经隐藏控制检查" : current ? `${current.title} · ${NODE_TYPE_LABELS[current.type]}` : "目标步骤已不存在"}</option> : null}
            {slot.editable ? targets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title} · {NODE_TYPE_LABELS[candidate.type]}</option>) : null}
          </select>
          {hiddenTarget ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-800"><span>这条路径经过隐藏的控制检查，显示后才能修改。</span><button type="button" onClick={onRevealControlNodes} className="font-semibold text-indigo-700 underline">显示控制节点</button></div> : null}
          {!slot.editable ? <p className="mt-1 text-xs text-amber-800">当前等待设置不再使用这条超时路径，只能断开；如需重设，请先启用等待超时。</p> : null}
        </div>;
      })}
    </div> : <p className="mt-3 text-xs text-slate-500">这是流程的完成步骤，没有后续路径。</p>}
    {incoming.length > 0 ? <div className="mt-3 border-t border-indigo-100 pt-3">
      <p className="text-xs font-semibold text-slate-700">从哪里来到这一步</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {incoming.filter(({ source }) => showControlNodes || !isHiddenControlNode(source)).map(({ source, handle, label }, index) =>
          <span key={`${source.id}-${handle}-${index}`} className="inline-flex min-w-0 items-center rounded-full border border-slate-200 bg-white text-xs">
            <button type="button" onClick={() => onFocusNode(source.id)} className="min-w-0 truncate rounded-l-full py-1 pl-2.5 pr-1 text-left text-indigo-700 hover:underline" title={`查看“${source.title}”`}>{source.title} · {label}</button>
            <button type="button" aria-label={`断开来自${source.title}的${label}路径`} onClick={() => setPendingIncoming({ sourceId: source.id, sourceTitle: source.title, handle, label })}
              className="shrink-0 rounded-r-full border-l border-slate-200 py-1 pl-1.5 pr-2.5 font-semibold text-red-700 hover:bg-red-50">断开</button>
          </span>)}
        {hiddenIncoming > 0 ? <button type="button" onClick={onRevealControlNodes} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800">另有 {hiddenIncoming} 条控制检查路径 · 显示</button> : null}
      </div>
    </div> : null}
    <ConfirmDialog open={pendingIncoming !== null} onOpenChange={(open) => { if (!open) setPendingIncoming(null); }}
      title="断开这条上游路径？"
      description={pendingIncoming ? `“${pendingIncoming.sourceTitle}”的“${pendingIncoming.label}”将不再进入“${node.title}”。这可能改变后续执行；可撤销，保存草稿后生效。` : ""}
      confirmLabel="断开路径"
      onConfirm={() => {
        if (!pendingIncoming) return;
        onDisconnectIncoming(pendingIncoming.sourceId, pendingIncoming.handle, node.id);
        setPendingIncoming(null);
      }} />
  </section>;
}
