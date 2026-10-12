"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import type { WorkflowNode } from "@/contracts/workflow";
import { toolBindingChanges } from "./tool-binding-status";

const riskLabels = { low: "低风险", medium: "中风险", high: "高风险" } as const;

export function ToolRebindNotice({ snapshot, option, onConfirm }: {
  snapshot: NonNullable<WorkflowNode["tool"]>;
  option: ToolRegistryOption;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const changes = toolBindingChanges(snapshot, option);
  if (!changes.length) return null;

  return <div className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-3">
    <p role="status" className="text-xs font-semibold leading-5 text-amber-950">工具配置已变化：{changes.join("、")}。</p>
    <p className="mt-1 text-xs leading-5 text-amber-900">当前步骤仍保留旧绑定，不会自动换成新配置。请核对后重新绑定，再保存、检查和发布。</p>
    <button type="button" onClick={() => setOpen(true)} className="mt-2 min-h-9 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100">核对并重新绑定</button>
    <ConfirmDialog open={open} onOpenChange={setOpen} title="更新这个工具步骤的绑定？" tone="warning" confirmLabel="确认重新绑定"
      description={`将使用“${option.name}”当前登记的配置，变化包括：${changes.join("、")}。原风险为${riskLabels[snapshot.risk]}，当前为${riskLabels[option.risk]}。这只修改本地草稿，仍需保存、设计检查和重新发布；不会重跑已有任务，也不代表连接已验证或权限已获批。`}
      onConfirm={() => { setOpen(false); onConfirm(); }} />
  </div>;
}
