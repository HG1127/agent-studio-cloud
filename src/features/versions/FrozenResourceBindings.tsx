"use client";

import { useId, useState } from "react";
import type { FrozenResourceBindingsView } from "./frozen-resource-bindings";

export function FrozenResourceBindings({ view, onLocateStep, collapsible = false }: {
  view: FrozenResourceBindingsView;
  onLocateStep?: (ownerNodeId: string) => void;
  collapsible?: boolean;
}) {
  const headingId = useId();
  const [error, setError] = useState<{ view: FrozenResourceBindingsView; message: string } | null>(null);
  const locate = (ownerNodeId: string) => {
    if (view.state !== "available" || !onLocateStep || !view.steps.some((step) => step.ownerNodeId === ownerNodeId)) return;
    setError(null);
    try { onLocateStep(ownerNodeId); }
    catch { setError({ view, message: "暂时无法定位所属步骤，请在冻结步骤列表中核对。" }); }
  };
  const References = collapsible ? "details" : "div";
  return <section aria-labelledby={headingId} className="content-card min-w-0">
    <h2 id={headingId} className="section-title">冻结的资源声明与步骤引用</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">{view.notice}</p>
    {view.state === "unknown" ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">范围未知，不能当作没有资源或没有步骤。</p> : <>
      <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-3">
        <section aria-label="版本模型声明" className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">模型选择</h3>
          {view.model ? <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
            <li>{view.model.selection}</li><li>{view.model.mock}</li><li>{view.model.connection}</li>
          </ul> : <p className="mt-2 text-sm text-slate-600">模型声明未知。</p>}
        </section>
        <section aria-label="版本资料声明" className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">资料选择</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{view.knowledge?.description ?? "资料声明未知。"}</p>
          {view.knowledge?.items.length ? <ol className="mt-2 space-y-2 text-xs leading-5 text-slate-600">
            {view.knowledge.items.map((item, index) => <li key={index}>{item.label}{item.repeated > 1 ? <span className="block text-amber-900">原列表有 {item.repeated} 项同标识声明，未合并或删除。</span> : null}</li>)}
          </ol> : null}
        </section>
        <section aria-label="版本工具声明" className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">工具目录</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{view.tools}</p>
        </section>
      </div>
      {view.warnings.length ? <ul aria-label="资源核对提示" className="mt-3 space-y-2 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">
        {view.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
      </ul> : null}
      <References aria-label={collapsible ? "核对步骤资源引用" : undefined} className={collapsible ? "mt-4 rounded-xl border border-slate-200 p-3" : undefined}>
      {collapsible ? <summary className="cursor-pointer text-sm font-semibold text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-500">查看步骤资源引用（{view.steps.length} 项）</summary> : null}
      <h3 className="mt-5 text-sm font-semibold text-slate-900">步骤中保存的引用</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">按原快照的标识核对同一版本中的声明；名称只作显示。内嵌步骤定位到所属顶层步骤。</p>
      {view.steps.length ? <ol aria-label="冻结资源步骤列表" className="mt-3 space-y-3">
        {view.steps.map((step, index) => <li key={index} className="min-w-0 rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h4 className="break-words text-sm font-semibold text-slate-900">第 {index + 1} 项 · {step.name}</h4><p className="mt-1 break-words text-xs leading-5 text-slate-500">{step.context}</p></div>
            {onLocateStep && step.ownerNodeId !== null ? <button type="button" onClick={() => locate(step.ownerNodeId!)}
              className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500">定位所属步骤</button> : null}
          </div>
          {step.bindings.length ? <ul className="mt-3 space-y-3">
            {step.bindings.map((binding, bindingIndex) => <li key={bindingIndex}>
              <p className="text-xs font-semibold text-slate-700">{binding.kind}声明</p>
              <ul className="mt-1 space-y-1 text-sm leading-6 text-slate-600">{binding.details.map((detail, detailIndex) => <li key={detailIndex} className="break-words">{detail}</li>)}</ul>
            </li>)}
          </ul> : <p className="mt-3 text-sm leading-6 text-slate-600">这里没有可解释的模型、资料或工具声明，不能据此判断运行时是否使用其他资源。</p>}
          {step.warnings.length ? <ul className="mt-3 space-y-1 text-xs leading-5 text-amber-900">{step.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}</ul> : null}
        </li>)}
      </ol> : <p role="status" className="mt-3 text-sm text-slate-600">原流程明确保存了 0 个顶层步骤，没有生成替代步骤。</p>}
      </References>
    </>}
    {error?.view === view ? <p role="alert" className="mt-3 text-sm text-amber-900">{error.message}</p> : null}
  </section>;
}
