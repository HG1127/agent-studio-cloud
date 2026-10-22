"use client";

import { useContext, useId, useMemo, useState } from "react";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { QualityGateReview } from "./QualityGateReview";
import { QualityGateRulesEditor } from "./QualityGateRulesEditor";
import { acceptQualityGateRulesRequest, beginQualityGateRulesEdit, qualityGateRulesState } from "./quality-gate-rules-editing";
import { NodeContractEditContext } from "./use-node-contract-edits";

export function NodeQualityRules({ node, workflow, sourcesComplete = false, onLocateStep }: {
  node: WorkflowNode;
  workflow?: WorkflowDraft;
  sourcesComplete?: boolean;
  onLocateStep?: (nodeId: string) => void;
}) {
  const memory = useContext(NodeContractEditContext);
  const identity = { parentId: node.id };
  const entry = memory?.store.read(identity, "quality");
  const [opened, setOpened] = useState(() => Boolean(entry));
  const [, setVersion] = useState(0);
  const panelId = useId();
  const revision = memory?.epoch;
  const state = useMemo(() => qualityGateRulesState(workflow, node.id, sourcesComplete), [workflow, node.id, sourcesComplete]);
  const original = useMemo(() => revision !== undefined && workflow ? beginQualityGateRulesEdit(workflow, node.id, revision, sourcesComplete) : null, [revision, workflow, node.id, sourcesComplete]);

  function refresh(previousCount: number) {
    setVersion((value) => value + 1);
    if (memory && previousCount !== memory.store.pendingCount) memory.refresh();
  }

  return <div className="min-w-0 space-y-3">
    <QualityGateReview originalNode={node} originalWorkflow={sourcesComplete ? workflow : undefined} source="draft" onLocateStep={sourcesComplete ? onLocateStep : undefined} />
    {memory && workflow && (state.editable || entry || opened) ? <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3">
      <button type="button" aria-expanded={opened} aria-controls={panelId} onClick={() => setOpened((value) => !value)} className="min-h-9 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-semibold text-indigo-800">{opened ? "收起质量规则编辑" : "编辑交付质量规则"}</button>
      <p className="mt-2 text-xs leading-5 text-slate-600">明确应用后才改变画布；暂时收起、切换步骤或关闭详情仍保留未应用填写，保存前须应用或取消。</p>
      {opened ? <div id={panelId} className="mt-3"><QualityGateRulesEditor canvasDraft={workflow} nodeId={node.id} revision={memory.epoch} sourcesComplete={sourcesComplete} showCurrentSummary={false}
        onApply={(request) => {
          const current = memory.store.read(identity, "quality");
          if (!current) return false;
          const accepted = acceptQualityGateRulesRequest(workflow, memory.store.epoch, node.id, sourcesComplete, request,
            { epoch: current.epoch, revision: current.revision, generation: current.generation });
          if (!accepted.ok) return false;
          return memory.commit({ identity, field: "quality", node: accepted.node, expectedNode: node, expectedParent: workflow.nodes[node.id],
            epoch: memory.store.epoch, generation: memory.store.generation(identity), revision: current.revision });
        }} memory={{
          epoch: memory.epoch, entry,
          change: (value) => {
            const previousCount = memory.store.pendingCount;
            const dirty = !state.configured || !original?.ok || JSON.stringify(value.input) !== JSON.stringify(original.edit.input);
            memory.store.write(identity, "quality", value, dirty);
            refresh(previousCount);
          },
          discard: (expected) => {
            const current = memory.store.read(identity, "quality");
            if (!current || !expected || current.epoch !== expected.epoch || current.revision !== expected.revision || current.generation !== expected.generation) return;
            const previousCount = memory.store.pendingCount;
            memory.store.clear(identity, "quality", current.revision);
            refresh(previousCount);
          },
        }} /></div> : null}
    </div> : state.editable && (!memory || !workflow) ? <p className="text-xs leading-5 text-slate-500">当前页面没有接入完整画布修订与填写保留，质量规则编辑暂不可用。</p> : null}
  </div>;
}
