"use client";

import { useRef, useState } from "react";
import { AgentInputField } from "@/contracts/manifest";
import { MAX_WORKFLOW_VARIABLES, type WorkflowNode, type WorkflowVariable } from "@/contracts/workflow";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { requestWorkflowNodeFocus } from "@/lib/workflow-node-focus";
import { INPUT_TYPE_LABELS, inputDefinitionIssue, inputDefinitionReferences, moveInputDefinition } from "./workflow-input-editing";

export function WorkflowInputEditor({ variables, nodes = {}, agentId, onChange }: {
  variables: WorkflowVariable[];
  nodes?: Record<string, WorkflowNode>;
  agentId?: string;
  onChange: (variables: WorkflowVariable[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<"all" | "run" | "legacy" | "issue">("all");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ kind: "remove" | "convert"; index: number; snapshot: string; label: string } | null>(null);
  const returnFocus = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const labelInputs = useRef<Array<HTMLInputElement | null>>([]);
  const rows = variables.map((variable, index) => ({ variable, index, issue: inputDefinitionIssue(variable, variables) }));
  const matching = rows.filter(({ variable, issue }) =>
    (range === "all" || (range === "run" ? variable.scope === "run" : range === "legacy" ? variable.scope !== "run" : !!issue))
    && (!query.trim() || `${variable.name} ${variable.label ?? ""} ${variable.description ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
  );
  const visible = expanded ? matching : matching.slice(0, 8);
  const hasFilters = Boolean(query.trim()) || range !== "all";
  const runCount = variables.filter((variable) => variable.scope === "run").length;
  const pendingVariable = confirmation ? variables[confirmation.index] : undefined;
  const pendingReferences = pendingVariable ? inputDefinitionReferences(pendingVariable.name, nodes) : [];

  function update(index: number, patch: Partial<WorkflowVariable>) {
    setError(null);
    onChange(variables.map((variable, position) => position === index ? { ...variable, ...patch } : variable));
  }
  function add() {
    if (variables.length >= MAX_WORKFLOW_VARIABLES) return;
    let index = variables.length + 1;
    while (variables.some((variable) => variable.name === `field_${index}`)) index += 1;
    setError(null);
    setQuery(""); setRange("all"); setExpanded(true);
    onChange([...variables, { name: `field_${index}`, label: "新输入字段", type: "string", scope: "run", required: true }]);
    requestAnimationFrame(() => labelInputs.current[variables.length]?.focus());
  }
  function move(index: number, delta: -1 | 1) {
    const next = moveInputDefinition(variables, index, delta);
    if (next === variables) return;
    setError(null);
    onChange(next);
    setExpanded(true);
    requestAnimationFrame(() => labelInputs.current[index + delta]?.focus());
  }
  function confirmChange() {
    if (!confirmation) return;
    if (JSON.stringify(variables) !== confirmation.snapshot) {
      setError("输入定义已发生变化，请重新核对后再操作。");
      setConfirmation(null);
      return;
    }
    const index = confirmation.index;
    setError(null);
    if (confirmation.kind === "remove") {
      returnFocus.current = addButton.current;
      onChange(variables.filter((_, position) => position !== index));
    } else update(index, { scope: "run" });
    setConfirmation(null);
  }
  function resetFilters() { setQuery(""); setRange("all"); setExpanded(false); }

  return <details className="rounded-xl border border-slate-200 bg-white p-4">
    <summary className="cursor-pointer text-sm font-semibold text-slate-950">运行输入字段（{variables.length || "默认"}）</summary>
    <section aria-label="运行输入定义工作台" className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-slate-600">定义员工运行助手时填写的内容。修改只留在当前草稿，保存并发布后才影响新版本；字段名或类型改变不会自动改写条件和逐项处理来源。</p>
      <p className="text-xs leading-5 text-slate-500">没有显式定义时，发布可能从已有来源推导输入；仍没有输入时使用“业务输入”文本框。最终字段和顺序以所发布版本的表单为准。</p>
      <dl aria-label="输入定义概览" className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-indigo-50 p-2.5"><dt className="text-indigo-700">本次运行定义</dt><dd className="mt-1 text-lg font-semibold text-indigo-900">{runCount}</dd></div>
        <div className="rounded-lg bg-slate-50 p-2.5"><dt className="text-slate-600">其他范围原定义</dt><dd className="mt-1 text-lg font-semibold text-slate-900">{variables.length - runCount}</dd></div>
        <div className="rounded-lg bg-amber-50 p-2.5"><dt className="text-amber-800">需核对字段</dt><dd className="mt-1 text-lg font-semibold text-amber-900">{rows.filter((row) => row.issue).length}</dd></div>
      </dl>
      {variables.length > 0 ? <>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 text-xs font-medium text-slate-700">查找输入定义<input aria-label="查找输入定义" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setExpanded(false); }} placeholder="按名称或业务说明查找" className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm" /></label>
          <label className="text-xs font-medium text-slate-700">定义范围<select aria-label="输入定义范围" value={range} onChange={(event) => { setRange(event.target.value as typeof range); setExpanded(false); }} className="mt-1 block h-9 max-w-full rounded-lg border border-slate-300 px-2 text-sm"><option value="all">全部定义</option><option value="run">本次运行</option><option value="legacy">其他原定义</option><option value="issue">需核对字段</option></select></label>
          {hasFilters ? <button type="button" onClick={resetFilters} className="h-9 rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-700">清除输入筛选</button> : null}
        </div>
        <p role="status" className="text-xs text-slate-500">匹配 {matching.length} 项，显示 {visible.length} 项。顺序操作调整完整定义，不仅是筛选结果。</p>
        {visible.length ? <ol aria-label="输入定义列表" className="space-y-3">
          {visible.map(({ variable, index, issue }) => {
            const editable = variable.scope === "run";
            const type = AgentInputField.shape.type.safeParse(variable.type);
            const references = inputDefinitionReferences(variable.name, nodes);
            return <li key={index} className="min-w-0 rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-words text-sm font-semibold text-slate-900">{variable.label?.trim() || `输入定义 ${index + 1}`}</h3><span className={`rounded px-2 py-0.5 text-xs ${editable ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-800"}`}>{editable ? "本次运行" : variable.scope === "shared" ? "原团队共享定义，未接入" : variable.scope === "private" ? "原私有定义，未接入" : "其他范围原定义，未接入"}</span></div>
              <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
                <label className="min-w-0 text-xs text-slate-600">字段名<input aria-label={`字段 ${index + 1} 名称`} value={variable.name} disabled={!editable} maxLength={200} onChange={(event) => {
                  const cleaned = event.target.value.replace(/[^A-Za-z0-9_]/g, "");
                  update(index, { name: /^\d/.test(cleaned) ? `_${cleaned}` : cleaned });
                }} className="mt-1 w-full min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50" /><span className="mt-1 block text-[11px] leading-4">只使用字母、数字和下划线；建议只改显示名称，保留原字段引用。</span></label>
                <label className="min-w-0 text-xs text-slate-600">显示名称<input ref={(element) => { labelInputs.current[index] = element; }} aria-label={`字段 ${index + 1} 显示名称`} value={variable.label ?? ""} disabled={!editable} maxLength={200} onChange={(event) => update(index, { label: event.target.value })} className="mt-1 w-full min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50" /></label>
                <label className="min-w-0 text-xs text-slate-600">内容类型<select aria-label={`字段 ${index + 1} 类型`} value={variable.type} disabled={!editable} onChange={(event) => update(index, { type: event.target.value })} className="mt-1 w-full min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50">
                  {!type.success ? <option value={variable.type}>原类型未明确或不受支持</option> : null}{Object.entries(INPUT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select></label>
                <label className="flex items-center gap-2 self-end py-1.5 text-xs text-slate-600"><input aria-label={`字段 ${index + 1} 必填`} type="checkbox" checked={variable.required} disabled={!editable} onChange={(event) => update(index, { required: event.target.checked })} />员工必须填写</label>
                <label className="min-w-0 text-xs text-slate-600 xl:col-span-2">业务说明<textarea aria-label={`字段 ${index + 1} 业务说明`} rows={2} value={variable.description ?? ""} disabled={!editable} maxLength={1000} onChange={(event) => update(index, { description: event.target.value })} className="mt-1 w-full min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50" /><span className="mt-1 block text-[11px] leading-4">本次运行字段的说明随草稿保存，发布后作为该版本表单的填写提示；不会自动进入模型提示。</span></label>
              </div>
              {issue ? <p role="alert" className="mt-2 text-xs leading-5 text-amber-800">{issue}</p> : null}
              {!editable ? <p className="mt-2 text-xs leading-5 text-amber-800">原范围仅作配置核对，不代表共享或私有状态已实现；不会自动改为本次运行输入，也不提供默认值。</p> : null}
              <div className="mt-3 rounded-lg bg-slate-50 p-2.5"><p className="text-xs font-medium text-slate-700">主流程来源核对（{references.length} 个关联步骤）</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">只列条件与逐项处理的结构化来源，不包括说明文字、工具内部规则或模型对完整输入的使用。</p>
                {references.length ? <ul className="mt-1 space-y-1">{references.map((reference) => <li key={reference.nodeId} className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-600"><span className="break-words">{reference.title} · {reference.kind}</span>{agentId ? <button type="button" onClick={() => requestWorkflowNodeFocus({ agentId, nodeId: reference.nodeId })} className="rounded px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-50">查看关联流程步骤</button> : null}</li>)}</ul> : <p className="text-xs leading-5 text-slate-500">未发现上述结构化引用，不能据此判断删除或改名没有影响。</p>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" aria-label={`上移输入字段 ${index + 1}`} disabled={!editable || index === 0} onClick={() => move(index, -1)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 disabled:opacity-40">上移</button>
                <button type="button" aria-label={`下移输入字段 ${index + 1}`} disabled={!editable || index === variables.length - 1} onClick={() => move(index, 1)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 disabled:opacity-40">下移</button>
                {!editable ? <button type="button" aria-label={`设为本次运行输入字段 ${index + 1}`} onClick={(event) => { returnFocus.current = event.currentTarget; setConfirmation({ kind: "convert", index, snapshot: JSON.stringify(variables), label: variable.label?.trim() || `输入定义 ${index + 1}` }); }} className="rounded-lg border border-indigo-200 px-2 py-1.5 text-xs font-medium text-indigo-700">纳入本次运行输入</button> : null}
                <button type="button" aria-label={`删除输入字段 ${index + 1}`} onClick={(event) => { returnFocus.current = event.currentTarget; setConfirmation({ kind: "remove", index, snapshot: JSON.stringify(variables), label: variable.label?.trim() || `输入定义 ${index + 1}` }); }} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">删除</button>
              </div>
            </li>;
          })}
        </ol> : <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs leading-5 text-slate-600">没有匹配的输入定义，其他字段仍保留。<button type="button" onClick={resetFilters} className="ml-2 font-medium text-indigo-700">查看全部输入定义</button></div>}
        {matching.length > 8 ? <button type="button" onClick={() => setExpanded((current) => !current)} className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-700">{expanded ? "收起其他输入定义" : `展开其他 ${matching.length - 8} 项输入定义`}</button> : null}
      </> : <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">没有显式定义输入字段。简单流程可以不添加，发布时仍需核对实际生成的输入表单。</p>}
      {variables.length >= MAX_WORKFLOW_VARIABLES ? <p className="text-xs text-amber-800">运行输入字段已达到 {MAX_WORKFLOW_VARIABLES} 项上限。</p> : null}
      <button ref={addButton} type="button" disabled={variables.length >= MAX_WORKFLOW_VARIABLES} onClick={add} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">添加输入字段</button>
      {error ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">{error}</p> : null}
    </section>
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }} title={confirmation?.kind === "convert" ? "纳入本次运行输入？" : "删除这项输入定义？"}
      description={confirmation?.kind === "convert" ? `“${confirmation.label}”会改为本次运行输入，保存并发布后可能出现在员工运行表单中。它不建立团队共享、私有权限或默认值；原字段其他设置保留。` : confirmation ? `将从本地草稿移除“${confirmation.label}”。当前发现 ${pendingReferences.length} 个关联步骤，但删除不会改写已有来源，发布仍可能推导出同名输入。保存前可撤销，请先核对流程。` : ""}
      confirmLabel={confirmation?.kind === "convert" ? "设为本次运行输入" : "删除输入定义"} tone="warning" returnFocusRef={returnFocus} onConfirm={confirmChange} />
  </details>;
}
