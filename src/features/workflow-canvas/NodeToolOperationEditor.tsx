"use client";

import { useRef, useState, type MouseEvent } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ToolOperationConfig } from "@/contracts/tool-operation";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { applyNodeToolOperationDraft, clearNodeToolOperation, createToolOperationEditorDraft, inspectNodeToolOperation, toolOperationOutputFields, toolOperationSources, type ToolOperationEditorContext, type ToolOperationEditorDraft } from "./node-tool-operation-editing";
import type { ContractEditorMemory, ToolContractEdit } from "./use-node-contract-edits";

type Editing = ToolContractEdit & { contextRevision: number; epoch: number; revision: number };
type Confirmation = { kind: "clear"; snapshot: string; contextRevision: number; epoch: number; editRevision: number } | { kind: "replace"; editing: Editing };

export function NodeToolOperationEditor({ node, workflow, tools, inline, onNodeChange, memory }: { node: WorkflowNode; workflow: WorkflowDraft; tools: readonly ToolRegistryOption[]; inline?: ToolOperationEditorContext["inline"]; onNodeChange: (node: WorkflowNode) => boolean; memory?: ContractEditorMemory<ToolContractEdit> }) {
  const context = { node, workflow, tools, ...(inline ? { inline } : {}) };
  const state = inspectNodeToolOperation(context);
  const [observed, setObserved] = useState({ snapshot: state.snapshot, revision: 0 });
  // 比较最终内容不能发现往返修改，修订必须单调增加。
  const contextRevision = observed.snapshot === state.snapshot ? observed.revision : observed.revision + 1;
  if (observed.snapshot !== state.snapshot) setObserved({ snapshot: state.snapshot, revision: contextRevision });
  const epoch = memory?.epoch ?? contextRevision;
  const [localEditing, setLocalEditing] = useState<Editing | null>(null);
  const editing: Editing | null = memory ? memory.entry ? { ...memory.entry.value, epoch: memory.entry.epoch, revision: memory.entry.revision, contextRevision } : null : localEditing;
  function setEditing(value: Editing | null) {
    setLocalEditing(value);
    if (value) memory?.change({ snapshot: value.snapshot, draft: value.draft }); else memory?.discard();
  }
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const toggle = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const stale = editing !== null && (editing.epoch !== epoch || editing.snapshot !== state.snapshot || (!memory && editing.contextRevision !== contextRevision));
  const sources = toolOperationSources(context);
  const outputFields = toolOperationOutputFields(sources.outputs.find((source) => source.id === editing?.draft.nodeId));
  const inputClass = "mt-1 block w-full rounded border border-slate-300 p-2 text-sm";

  function begin() {
    const draft = createToolOperationEditorDraft(context);
    if (!draft || state.snapshot === null) return;
    setEditing({ snapshot: state.snapshot, contextRevision, epoch, revision: 0, draft }); setError(null); setNotice(null); setConfirmation(null);
  }
  function cancel() { setEditing(null); setConfirmation(null); setError(null); toggle.current?.focus(); }
  function change(draft: ToolOperationEditorDraft) {
    if (!editing) return;
    setEditing({ ...editing, revision: editing.revision + 1, draft }); setConfirmation(null); setNotice(null); setError(null);
  }
  function accept(next: WorkflowNode, clearing: boolean) {
    try {
      if (onNodeChange(next) !== true) { setError("当前画布没有确认接收修改，编辑内容仍已保留。"); return; }
    } catch { setError("当前画布未接收修改，编辑内容仍已保留。"); return; }
    setEditing(null); setError(null); setNotice(clearing ? "防重规则已从当前页面草稿清除，尚未保存或发布。" : "防重规则已应用到当前页面草稿，尚未保存或发布。");
    returnFocus.current = toggle.current; toggle.current?.focus();
  }
  function commit(value: Editing) {
    if (value.epoch !== epoch || (!memory && value.contextRevision !== contextRevision) || value.revision !== editing?.revision || stale) { setError("步骤、流程、登记或编辑内容已变化，请重新确认。"); return; }
    const result = applyNodeToolOperationDraft(context, value.draft, value.snapshot);
    if (!result.ok) setError(result.error); else accept(result.node, false);
  }
  function apply(event: MouseEvent<HTMLButtonElement>) {
    if (!editing) return;
    const result = applyNodeToolOperationDraft(context, editing.draft, editing.snapshot);
    if (!result.ok) { setError(result.error); return; }
    if (state.configured) { returnFocus.current = event.currentTarget; setConfirmation({ kind: "replace", editing }); }
    else commit(editing);
  }
  function confirm() {
    if (!confirmation) return;
    if (confirmation.kind === "replace") commit(confirmation.editing);
    else if (confirmation.epoch !== epoch || (!memory && confirmation.contextRevision !== contextRevision) || confirmation.editRevision !== (editing?.revision ?? -1)) setError("步骤、流程、登记或编辑内容已变化，请重新确认。");
    else {
      const result = clearNodeToolOperation(context, confirmation.snapshot);
      if (!result.ok) setError(result.error); else accept(result.node, true);
    }
    setConfirmation(null);
  }
  const draft = editing?.draft;
  const canUseRegisteredScope = state.registration && ToolOperationConfig.shape.scope.safeParse(state.registration.scope).success;
  return <section aria-label="业务操作防重" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <h3 className="text-sm font-semibold text-slate-950">业务操作防重</h3>
    <p className="text-xs leading-5 text-slate-600">让同一业务标识在登记有效期内复用已完成回执；业务内容不同或结果不确定时仍需人工核对。工具登记声明不能证明外部系统一定防重。这里只编辑当前页面草稿，不执行工具，仍需保存并发布。</p>
    <label className="flex items-center gap-2 text-sm"><input ref={toggle} type="checkbox" aria-label="设置业务操作防重" checked={state.configured || editing !== null} disabled={!state.editable || stale} onChange={(event) => {
      setError(null); setNotice(null);
      if (event.target.checked) begin();
      else if (state.configured && state.snapshot !== null) { returnFocus.current = event.currentTarget; setConfirmation({ kind: "clear", snapshot: state.snapshot, contextRevision, epoch, editRevision: editing?.revision ?? -1 }); }
      else cancel();
    }} />设置业务操作防重</label>
    {!state.configured && !editing ? <p className="text-xs text-slate-500">尚未设置；打开开关只打开编辑区，不会自动写入规则。</p> : null}
    {state.issue ? <p role="alert" className="text-xs leading-5 text-amber-800">{state.issue}</p> : null}
    {state.registration?.businessIdempotency === true && state.registration.businessIdempotencyRetentionMs ? <p className="text-xs text-slate-600">登记防重有效期：{state.registration.businessIdempotencyRetentionMs / 60000}分钟。实际可重发期限由执行记录决定。</p> : null}
    {state.config ? <p className="text-xs text-slate-600">当前标识来源：{state.config.key.kind === "input" ? "业务输入" : state.config.key.kind === "output" ? "业务成果" : "固定值"}。{state.config.key.kind !== "literal" ? "运行时仍须取得有效的短文字或安全整数。" : "固定值会让相同范围内的运行共用一个业务标识，请核对它是否符合业务目的。"}</p> : null}
    {state.configured ? <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold">维护人员原始规则（只读）</summary><textarea aria-label="原始防重规则只读" readOnly value={state.rawText ?? "原内容无法完整显示，仍已保留。"} rows={5} className={inputClass} /></details> : null}
    {state.editable && state.configured && !editing ? <button type="button" onClick={begin} className="min-h-9 rounded border px-3 text-xs">编辑防重规则</button> : null}
    {editing && draft ? <div className="space-y-3 rounded-lg border border-indigo-200 p-3">
      {stale ? <p role="alert" className="text-xs text-amber-800">步骤、流程或登记曾发生变化，请取消后重新打开。当前输入已保留，不能覆盖新草稿。</p> : null}
      <fieldset disabled={stale || !state.editable} className="space-y-3">
        <label className="block text-xs">防重范围<select aria-label="防重范围" value={draft.scope === state.config?.scope ? "existing" : draft.scope === state.registration?.scope ? "registered" : ""} onChange={(event) => change({ ...draft, scope: event.target.value === "existing" ? state.config?.scope ?? "" : event.target.value === "registered" ? state.registration?.scope ?? "" : "" })} className={inputClass}><option value="">请选择范围</option>{state.config ? <option value="existing">保留当前防重范围</option> : null}{canUseRegisteredScope ? <option value="registered">使用当前工具登记范围</option> : null}</select></label>
        <label className="block text-xs">业务标识来源<select aria-label="业务标识来源" value={draft.kind} onChange={(event) => change({ ...draft, kind: event.target.value as ToolOperationEditorDraft["kind"], nodeId: "", path: [], literalText: "" })} className={inputClass}><option value="">请选择来源</option><option value="input">业务输入</option><option value="output">业务成果</option><option value="literal">固定值</option></select></label>
        {draft.kind === "input" ? <label className="block text-xs">业务输入字段<select aria-label="业务输入字段" value={draft.path[0] ?? ""} onChange={(event) => change({ ...draft, path: event.target.value ? [event.target.value] : [] })} className={inputClass}><option value="">请选择已定义的业务字段</option>{sources.inputs.map((input, index) => <option key={input.name} value={input.name}>{input.label?.trim() || `业务输入${index + 1}`}</option>)}{draft.path[0] && !sources.inputs.some((input) => input.name === draft.path[0]) ? <option value={draft.path[0]}>保留原来源字段</option> : null}</select></label> : null}
        {draft.kind === "output" ? <><label className="block text-xs">业务成果来源<select aria-label="业务成果来源" value={draft.nodeId} onChange={(event) => change({ ...draft, nodeId: event.target.value, path: [] })} className={inputClass}><option value="">请选择业务步骤</option>{sources.outputs.map((source, index) => <option key={source.id} value={source.id}>{source.title.trim() || `业务步骤${index + 1}`}</option>)}{draft.nodeId && !sources.outputs.some((source) => source.id === draft.nodeId) ? <option value={draft.nodeId}>保留原来源步骤</option> : null}</select></label><label className="block text-xs">成果字段<select aria-label="成果字段" value={outputFields.findIndex((field) => JSON.stringify(field.path) === JSON.stringify(draft.path.slice(0, field.path.length)))} onChange={(event) => change({ ...draft, path: outputFields[Number(event.target.value)]?.path ?? [] })} className={inputClass}><option value={-1}>保留原路径或选择已定义字段</option>{outputFields.map((field, index) => <option key={JSON.stringify(field.path)} value={index}>{field.label}</option>)}</select></label></> : null}
        {draft.kind === "input" || draft.kind === "output" ? <div className="space-y-2"><p className="text-xs text-slate-600">逐级填写字段路径，每一级为一个完整字段名，字段名中的点不会拆开。来源值须到运行时取得，当前不能证明它有效。</p>{draft.path.map((segment, index) => <div key={index} className="flex items-end gap-2"><label className="flex-1 text-xs">第{index + 1}级字段<input aria-label={`第${index + 1}级字段`} value={segment} readOnly={index === 0} maxLength={200} onChange={(event) => change({ ...draft, path: draft.path.map((part, position) => position === index ? event.target.value : part) })} className={inputClass} /></label>{index > 0 ? <button type="button" aria-label={`移除第${index + 1}级字段`} onClick={() => change({ ...draft, path: draft.path.filter((_, position) => position !== index) })} className="min-h-9 rounded border px-2 text-xs">移除</button> : null}</div>)}<button type="button" disabled={!draft.path.length || draft.path.length >= 32} onClick={() => change({ ...draft, path: [...draft.path, ""] })} className="min-h-9 rounded border px-3 text-xs">添加下一级字段</button></div> : null}
        {draft.kind === "literal" ? <><p className="text-xs text-amber-800">固定值会共用业务标识，不能自动区分不同订单或客户。</p><label className="block text-xs">固定值类型<select aria-label="固定值类型" value={draft.literalType} onChange={(event) => change({ ...draft, literalType: event.target.value === "number" ? "number" : "string" })} className={inputClass}><option value="string">文字</option><option value="number">整数</option></select></label><label className="block text-xs">固定业务标识<input aria-label="固定业务标识" value={draft.literalText} maxLength={256} onChange={(event) => change({ ...draft, literalText: event.target.value })} className={inputClass} /></label></> : null}
      </fieldset>
      <div className="flex gap-2"><button type="button" disabled={stale || !state.editable} onClick={apply} className="min-h-9 rounded bg-indigo-600 px-3 text-xs text-white disabled:opacity-50">应用到当前草稿</button><button type="button" onClick={cancel} className="min-h-9 rounded border px-3 text-xs">取消编辑</button></div>
    </div> : null}
    {error ? <p role="alert" className="text-xs text-red-700">防重规则未应用。{error}</p> : null}
    {notice ? <p role="status" className="text-xs text-indigo-700">{notice}</p> : null}
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }} title={confirmation?.kind === "clear" ? "清除当前防重规则？" : "替换当前防重规则？"} description={confirmation?.kind === "clear" ? "当前页面草稿将停止使用这条防重规则。请核对真实业务重复执行风险；已发布版本与已有执行记录不会因此改变。" : "范围或业务标识的变化会改变哪些业务操作被视为同一次。请核对真实业务含义；只替换当前页面草稿的防重规则。"} confirmLabel={confirmation?.kind === "clear" ? "确认清除防重规则" : "确认替换防重规则"} onConfirm={confirm} tone="warning" returnFocusRef={returnFocus} />
  </section>;
}
