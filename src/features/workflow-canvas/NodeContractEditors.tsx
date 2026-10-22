"use client";

import { useContext, useMemo, useState } from "react";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import { NodeInputMappingEditor } from "./NodeInputMappingEditor";
import { NodeModelOutputEditor } from "./NodeModelOutputEditor";
import { NodeToolOperationEditor } from "./NodeToolOperationEditor";
import { AiReworkLimitEditor } from "./AiReworkLimitEditor";
import { AiReworkLimitReview } from "./AiReworkLimitReview";
import { QualityGateReview } from "./QualityGateReview";
import { acceptAiReworkRequest, acceptAiReworkResetRequest } from "./ai-rework-editing";
import { createToolOperationEditorDraft, type ToolOperationEditorContext } from "./node-tool-operation-editing";
import { mappingEditFrom, mappingEligibility } from "./node-input-mapping-editing";
import { createModelOutputEditorDraft, inspectNodeModelOutput } from "./node-model-output-editing";
import { applyTopLevelNodeContract, readInlineContractNode, type NodeContractField } from "./node-contract-editing";
import { NodeContractEditContext, type ContractIdentity } from "./use-node-contract-edits";

export function NodeContractEditors({ node, workflow, toolOptions = [], inlineContext, label = "当前步骤", onNodeChange, onInlineChange, identity = { parentId: node.id } }: {
  node: WorkflowNode;
  workflow?: WorkflowDraft;
  toolOptions?: readonly ToolRegistryOption[];
  inlineContext?: ToolOperationEditorContext["inline"];
  label?: string;
  onNodeChange: (node: WorkflowNode) => void | boolean;
  onInlineChange?: (node: WorkflowNode, field: NodeContractField) => boolean;
  identity?: ContractIdentity;
}) {
  const memory = useContext(NodeContractEditContext);
  const [, setEditorVersion] = useState(0);
  const [opened, setOpened] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = mappingEligibility(node);
  const model = inspectNodeModelOutput(node);
  const showInput = input.editable || node.inputMapping !== undefined;
  const showModel = model.editable || node.modelOutput !== undefined;
  const showToolOperation = node.toolOperation !== undefined || (node.type === "tool" && node.tool?.protocol !== "demo");
  const showRework = node.type === "ai" && identity.stepId === undefined && !inlineContext;
  const reworkEntry = memory?.store.read(identity, "retry");
  const inlineParent = inlineContext?.parent, inlineIndex = inlineContext?.location.stepIndex, inlineBranch = inlineContext?.location.branchId;
  const inlineOriginal = useMemo(() => inlineParent && inlineIndex !== undefined ? readInlineContractNode(inlineParent, { stepIndex: inlineIndex, branchId: inlineBranch }) : null, [inlineParent, inlineIndex, inlineBranch]);
  if (!showInput && !showModel && !showToolOperation && !showRework) return null;

  function refreshEditing(previousCount: number) {
    setEditorVersion((value) => value + 1);
    if (memory && previousCount !== memory.store.pendingCount) memory.refresh();
  }

  function apply(next: WorkflowNode, field: NodeContractField) {
    setError(null);
    if (!workflow) { setError("完整流程草稿暂不可读，不能应用字段修改。原值保持不变。"); return false; }
    if (memory) {
      const entry = memory.store.read(identity, field);
      if (field === "retry" && entry?.revision !== reworkEntry?.revision) return false;
      try {
        return memory.commit({ identity, field, node: next, expectedNode: node, expectedParent: workflow.nodes[identity.parentId],
          epoch: memory.epoch, generation: memory.store.generation(identity), revision: entry?.revision ?? 0 });
      } catch { setError("画布未确认接受修改，本页填写仍保留，请重新核对。"); return false; }
    }
    if (onInlineChange) return onInlineChange(next, field);
    const result = applyTopLevelNodeContract(workflow, node, next, field);
    if (!result.ok) { setError(result.error); return false; }
    try { return onNodeChange(result.node) === true; }
    catch { setError("画布未确认接受修改，本页填写仍保留，请重新核对。"); return false; }
  }

  return <details className="min-w-0 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3" onToggle={(event) => { setVisible(event.currentTarget.open); if (event.currentTarget.open) setOpened(true); }}>
    <summary aria-label={label + "输入与结果约定"} aria-description={showRework ? "包含智能处理的自动返工设置" : undefined} className="cursor-pointer text-sm font-semibold text-slate-800">{showRework ? "输入、结果与返工设置" : "输入与结果约定"}</summary>
    <p className="mt-2 text-xs leading-5 text-slate-600">输入映射决定这一步接收哪些字段；结果约定用于检查模型返回的对象。两者不会替代整个流程的最终交付定义。{showToolOperation ? "业务工具也可在此设置操作防重；登记声明不代表已授权或已经执行。" : ""}</p>
    {opened ? <section aria-label={label + "字段约定"} className="mt-3 min-w-0 space-y-4">
      {!workflow ? <p role="status" className="text-xs leading-5 text-amber-900">完整流程草稿暂不可读，原设置已保留。本处不能编辑、试算或保存。</p> : <>
        {showInput ? <NodeInputMappingEditor node={node} workflow={workflow} previewVisible={visible} onNodeChange={(next) => apply(next, "inputMapping")} memory={memory ? {
          epoch: memory.epoch, entry: memory.store.read(identity, "inputMapping"),
          change: (value) => { const previousCount = memory.store.pendingCount; memory.store.write(identity, "inputMapping", value, JSON.stringify(value) !== JSON.stringify(mappingEditFrom(node))); refreshEditing(previousCount); },
          discard: () => { const previousCount = memory.store.pendingCount; memory.store.clear(identity, "inputMapping"); refreshEditing(previousCount); },
        } : undefined} /> : null}
        {showModel ? <NodeModelOutputEditor node={node} onNodeChange={(next) => apply(next, "modelOutput")} memory={memory ? {
          epoch: memory.epoch, entry: memory.store.read(identity, "modelOutput"),
          change: (value) => { const previousCount = memory.store.pendingCount; memory.store.write(identity, "modelOutput", value, node.modelOutput === undefined || JSON.stringify(value.draft) !== JSON.stringify(createModelOutputEditorDraft(node))); refreshEditing(previousCount); },
          discard: () => { const previousCount = memory.store.pendingCount; memory.store.clear(identity, "modelOutput"); refreshEditing(previousCount); },
        } : undefined} /> : null}
        {showToolOperation ? <NodeToolOperationEditor node={node} workflow={workflow} tools={toolOptions} inline={inlineContext} onNodeChange={(next) => apply(next, "toolOperation")} memory={memory ? {
          epoch: memory.epoch, entry: memory.store.read(identity, "toolOperation"),
          change: (value) => { const previousCount = memory.store.pendingCount; const original = createToolOperationEditorDraft({ node, workflow, tools: toolOptions, ...(inlineContext ? { inline: inlineContext } : {}) }); memory.store.write(identity, "toolOperation", value, node.toolOperation === undefined || JSON.stringify(value.draft) !== JSON.stringify(original)); refreshEditing(previousCount); },
          discard: () => { const previousCount = memory.store.pendingCount; memory.store.clear(identity, "toolOperation"); refreshEditing(previousCount); },
        } : undefined} /> : null}
        {showRework && memory ? <AiReworkLimitEditor originalDraft={workflow} nodeId={node.id} revision={memory.epoch} source="draft"
          onApply={(request) => {
            if (!memory) return false;
            const accepted = acceptAiReworkRequest(workflow, memory.store.epoch, node.id, request);
            if (!accepted.ok) { setError(accepted.error); return false; }
            return apply(accepted.node, "retry");
          }} onReset={(request) => {
            if (!memory) return false;
            const accepted = acceptAiReworkResetRequest(workflow, memory.store.epoch, node.id, request);
            if (!accepted.ok) { setError(accepted.error); return false; }
            return apply(accepted.node, "retry");
          }} memory={memory ? {
            epoch: memory.epoch, entry: reworkEntry,
            change: (value) => {
              const previousCount = memory.store.pendingCount;
              // 开启填写即等待明确应用或取消，保存不能等值变化或下一次渲染才拦截。
              memory.store.write(identity, "retry", value, true);
              refreshEditing(previousCount);
            },
            discard: () => { const previousCount = memory.store.pendingCount; if (reworkEntry) memory.store.clear(identity, "retry", reworkEntry.revision); refreshEditing(previousCount); },
          } : undefined} /> : null}
        {showRework && !memory ? <><AiReworkLimitReview originalNode={node} source="draft" /><p className="text-xs leading-5 text-slate-500">当前页面没有接入画布修订与填写保留，返工编辑暂不可用。</p></> : null}
        {inlineOriginal?.ok && node.type === "ai" ? <AiReworkLimitReview originalNode={inlineOriginal.raw} source="draft" inline /> : null}
        {inlineOriginal?.ok && Object.hasOwn(inlineOriginal.raw, "quality") ? <QualityGateReview originalNode={inlineOriginal.raw} originalWorkflow={workflow} source="draft" inline /> : null}
      </>}
      {error ? <p role="alert" className="text-xs leading-5 text-amber-900">{error}</p> : null}
    </section> : null}
  </details>;
}
