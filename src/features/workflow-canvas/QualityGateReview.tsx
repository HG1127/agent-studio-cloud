"use client";

import { useMemo, useState } from "react";
import { qualityGateView } from "./quality-gate-view";
import { isPassiveJsonData } from "@/contracts/json";
import { MAX_WORKFLOW_BYTES } from "@/contracts/workflow";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

export function QualityGateReview({ originalNode, originalWorkflow, onLocateStep, source = "saved", inline = false }: {
  originalNode: unknown;
  originalWorkflow: unknown;
  onLocateStep?: (nodeId: string) => void;
  source?: "saved" | "draft";
  inline?: boolean;
}) {
  const view = useMemo(() => qualityGateView(originalNode, originalWorkflow, { source, inline }), [originalNode, originalWorkflow, source, inline]);
  const [locateError, setLocateError] = useState<string | null>(null);
  const identifiers = new Set<string>();
  function collect(value: unknown) {
    if (!isPassiveJsonData(value, MAX_WORKFLOW_BYTES) || value === null || typeof value !== "object" || Array.isArray(value)) return;
    const raw = value as Record<string, unknown>;
    for (const key of ["id", "versionId"]) if (typeof raw[key] === "string") identifiers.add(raw[key]);
  }
  collect(originalNode); collect(originalWorkflow);
  if (isPassiveJsonData(originalWorkflow, MAX_WORKFLOW_BYTES) && originalWorkflow && typeof originalWorkflow === "object" && !Array.isArray(originalWorkflow)) {
    const nodes = (originalWorkflow as Record<string, unknown>).nodes;
    if (nodes && typeof nodes === "object" && !Array.isArray(nodes)) for (const [id, node] of Object.entries(nodes)) { identifiers.add(id); collect(node); }
  }
  function display(text: string) {
    let value = redactSensitiveText(text);
    for (const id of [...identifiers].sort((a, b) => b.length - a.length)) if (id) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      value = value.replace(new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`, "g"), "$1[内部标识已隐藏]");
    }
    return value;
  }
  return <section aria-label="交付前检查规则核对" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <div><h3 className="text-sm font-semibold text-slate-950">交付前检查规则核对</h3><p className="mt-1 break-words text-xs leading-5 text-slate-600">核对「{display(view.title)}」的{source === "saved" ? "原始设置" : "当前画布设置"}。本处只读，不判定运行已通过，也不修改检查规则。</p></div>
    {source === "draft" ? <p className="text-xs leading-5 text-slate-500">读取接口会补入契约默认值，画布也可能有未保存修改；以下只说明当前有效设置，不能证明字段当时已保存。</p> : null}
    {view.issue ? <p role={view.state === "absent" ? "status" : "alert"} className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">{view.issue}</p> : null}
    {view.state === "known" ? <>
      <dl className="space-y-3 text-xs leading-5">{view.fields.map((field) => <div key={field.label}>
        <dt className="font-semibold text-slate-800">{field.label}</dt>
        <dd className="mt-1 break-words text-slate-700">{display(field.text)}</dd>
        <dd className="mt-1 text-slate-500">{source === "draft" ? "当前有效设置；原字段是否显式保存无法从本次读取确认。" : field.saved ? "原始字段已保存" : "原稿未保存此字段；以上为规则默认值，不代表原稿已保存。"}</dd>
      </div>)}</dl>
      {view.extraFields ? <p className="text-xs leading-5 text-slate-500">原规则还有 {view.extraFields} 项额外字段，本页不解释它们，也不会删除或改写。</p> : null}
      {view.repeatedReferences ? <p className="text-xs leading-5 text-amber-900">原规则有 {view.repeatedReferences} 次重复来源引用；重复引用不增加有效结果数量。</p> : null}
      {view.sourcesIssue ? <p role="alert" className="text-xs leading-5 text-amber-900">{view.sourcesIssue}</p> : null}
      {view.automaticSources ? <p className="text-xs leading-5 text-slate-600">{view.automaticSourceNote}</p> : <div>
        <h4 className="text-xs font-semibold text-slate-800">{source === "saved" ? "原规则" : "当前规则"}指定的来源</h4>
        <ul className="mt-2 space-y-2">{view.sources.map((source, index) => <li key={index} className="rounded-lg border border-slate-200 p-3 text-xs leading-5">
          <p className="break-words font-medium text-slate-900">{display(source.title)}</p>
          <p className={"mt-1 " + (source.state === "found" ? "text-slate-600" : "text-amber-900")}>{source.note}</p>
          {source.nodeId && onLocateStep ? <button type="button" aria-label={"定位来源步骤：" + display(source.title)} className="mt-2 min-h-9 rounded-lg border border-slate-200 px-3 font-semibold text-indigo-700" onClick={() => {
            setLocateError(null);
            try { onLocateStep(source.nodeId!); }
            catch { setLocateError("暂时不能定位来源，请在当前流程中核对；本页没有改动规则。"); }
          }}>定位这一步</button> : source.nodeId ? <p className="mt-2 text-slate-500">当前页面没有接入定位入口，可按此标题在流程中核对。</p> : null}
        </li>)}</ul>
      </div>}
      <p className="text-xs leading-5 text-slate-500">这里只核对{source === "saved" ? "保存的" : "当前画布的"}规则与来源配置，不证明来源已执行、有产出或被检查采用。人工拒绝时，执行器可能保留结果并停止高影响动作；检查通过也不等于业务交付获批准。</p>
    </> : null}
    {locateError ? <p role="alert" className="text-xs leading-5 text-amber-900">{locateError}</p> : null}
  </section>;
}
