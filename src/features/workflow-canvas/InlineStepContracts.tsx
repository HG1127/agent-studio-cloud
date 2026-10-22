"use client";

import { useState } from "react";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import { NodeContractEditors } from "./NodeContractEditors";
import { applyInlineNodeContract, readInlineContractNode, type InlineContractLocation, type NodeContractField } from "./node-contract-editing";
import { inlineStepId } from "./inline-step-editing";

export function InlineStepContracts({ parent, workflow, toolOptions = [], location, label, onNodeChange }: {
  parent: WorkflowNode;
  workflow?: WorkflowDraft;
  toolOptions?: readonly ToolRegistryOption[];
  location: InlineContractLocation;
  label: string;
  onNodeChange: (node: WorkflowNode) => void | boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const current = readInlineContractNode(parent, location);
  if (!current.ok) return <p role="status" className="text-xs leading-5 text-amber-900">{current.error}</p>;

  function apply(next: WorkflowNode, field: NodeContractField) {
    setError(null);
    if (!workflow || !current.ok) { setError("完整流程草稿或当前组内步骤暂不可读，原设置保持不变。"); return false; }
    const result = applyInlineNodeContract(workflow, parent, location, current.node, next, field);
    if (!result.ok) { setError(result.error); return false; }
    try { return onNodeChange(result.node) === true; }
    catch { setError("画布未确认接受修改，本页填写仍保留，请重新核对。"); return false; }
  }

  return <div className="min-w-0 space-y-2">
    <NodeContractEditors node={current.node} workflow={workflow} toolOptions={toolOptions} inlineContext={{ parent, location }} label={label} onNodeChange={onNodeChange} onInlineChange={apply}
      identity={{ parentId: parent.id, branchId: location.branchId, stepId: inlineStepId(current.raw, location.stepIndex) }} />
    {error ? <p role="alert" className="text-xs leading-5 text-amber-900">{error}</p> : null}
  </div>;
}
