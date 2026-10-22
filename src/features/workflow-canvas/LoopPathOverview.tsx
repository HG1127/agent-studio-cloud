"use client";

import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { loopBodyPath } from "./loop-body-path";

export function LoopPathOverview({ nodeId, nodes, mode = "draft", onFocusNode }: {
  nodeId: WorkflowNode["id"];
  nodes: WorkflowDraft["nodes"];
  mode?: "draft" | "frozen";
  onFocusNode?: (nodeId: WorkflowNode["id"]) => void;
}) {
  const path = loopBodyPath(nodeId, nodes);
  return <section aria-label="循环内直接路径" className="min-w-0 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
    <h3 className="text-sm font-semibold text-slate-900">每项的直接处理路径</h3>
    <p className="text-xs leading-5 text-slate-600">{mode === "frozen"
      ? "冻结定义：只查看此版本保存的连接，不修改该版本或当前草稿，也不表示这些步骤已执行。"
      : "当前草稿：只查看本页定义的连接，不代表已保存、已发布或实际执行。定位只打开对应步骤，不修改流程。"}</p>
    <details open className="min-w-0">
      <summary className="cursor-pointer text-xs font-semibold text-slate-700">展开每项的直接处理路径</summary>
      {path.steps.length ? <ol className="mt-2 max-h-64 space-y-2 overflow-y-auto text-xs leading-5">
        {path.steps.map((step, index) => <li key={step.nodeId} className="flex min-w-0 items-start gap-2">
          <span className="shrink-0 text-slate-500">{index + 1}.</span>
          {onFocusNode ? <button type="button" onClick={() => onFocusNode(step.nodeId)} className="min-w-0 break-words text-left font-semibold text-indigo-700 underline decoration-indigo-200 underline-offset-2 hover:decoration-indigo-600">
            {step.title}{" "}<span className="ml-1 font-normal text-slate-500">· 定位步骤</span>
          </button> : <span className="min-w-0 break-words text-slate-700">{step.title}</span>}
        </li>)}
      </ol> : <p className="mt-2 text-xs leading-5 text-slate-600">当前未列出内部步骤，请先核对下方原因。</p>}
      <p role="status" className="mt-3 rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-900">{path.stop.message}</p>
    </details>
    {!onFocusNode ? <p className="text-xs leading-5 text-slate-500">当前只提供名称查看，没有可用的步骤定位入口。</p> : null}
    <p className="text-xs leading-5 text-slate-500">这里只按已核对的直接后续连接展开，不展开分支、内部工作或异常路径。真实执行可能暂停、失败或选择其他去向，请在运行记录中核对。</p>
  </section>;
}
