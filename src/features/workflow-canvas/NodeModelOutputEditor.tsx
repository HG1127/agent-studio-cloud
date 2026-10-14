"use client";

import { useRef, useState, type MouseEvent } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { isPassiveJsonData } from "@/contracts/json";
import { MAX_MODEL_MOCK_OUTPUT_BYTES, MAX_MODEL_OUTPUT_REPAIRS, MAX_MODEL_OUTPUT_SCHEMA_BYTES } from "@/contracts/model-output";
import type { WorkflowNode } from "@/contracts/workflow";
import { applyNodeModelOutputDraft, clearNodeModelOutput, createModelOutputEditorDraft, inspectNodeModelOutput, modelOutputNodeSnapshot, type ModelOutputEditorDraft } from "./node-model-output-editing";
import type { ContractEditorMemory, ModelContractEdit } from "./use-node-contract-edits";

function savedText(value: unknown): string {
  if (!isPassiveJsonData(value, MAX_MODEL_OUTPUT_SCHEMA_BYTES + MAX_MODEL_MOCK_OUTPUT_BYTES + 4096)) return "原信息无法完整显示，仍已保留。";
  return JSON.stringify(value, null, 2);
}

export function NodeModelOutputEditor({ node, onNodeChange, memory }: { node: WorkflowNode; onNodeChange: (node: WorkflowNode) => void | boolean; memory?: ContractEditorMemory<ModelContractEdit> }) {
  const state = inspectNodeModelOutput(node);
  const currentSnapshot = modelOutputNodeSnapshot(node);
  const [nodeVersion, setNodeVersion] = useState({ snapshot: currentSnapshot, epoch: 0 });
  const localEpoch = nodeVersion.snapshot === currentSnapshot ? nodeVersion.epoch : nodeVersion.epoch + 1;
  if (nodeVersion.snapshot !== currentSnapshot) setNodeVersion({ snapshot: currentSnapshot, epoch: localEpoch });
  const epoch = memory?.epoch ?? localEpoch;
  const [localEditing, setLocalEditing] = useState<(ModelContractEdit & { epoch: number }) | null>(null);
  const editingRevision = useRef(0);
  const editing = memory?.entry?.value ?? localEditing;
  function setEditing(value: ModelContractEdit | null) {
    editingRevision.current += 1;
    setLocalEditing(value ? { ...value, epoch } : null);
    if (value) memory?.change(value); else memory?.discard();
  }
  const [confirmation, setConfirmation] = useState<({ kind: "clear"; snapshot: string } | { kind: "replace"; snapshot: string; draft: ModelOutputEditorDraft }) & { epoch: number; revision: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const toggle = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const stale = editing !== null && (currentSnapshot !== editing.snapshot || (memory?.entry?.epoch ?? localEditing?.epoch) !== epoch);

  function begin() {
    const draft = createModelOutputEditorDraft(node);
    if (!draft || currentSnapshot === null) return;
    setError(null); setNotice(null);
    setEditing({ snapshot: currentSnapshot, draft });
  }

  function cancel() {
    setEditing(null); setError(null);
    toggle.current?.focus();
  }

  function commit(snapshot: string, draft: ModelOutputEditorDraft) {
    const result = applyNodeModelOutputDraft(node, draft, snapshot);
    if (!result.ok) { setError(result.error); return; }
    if (onNodeChange(result.node) === false) { setError("完整画布草稿未接受这次修改，原值与本页编辑均保留。请核对下方说明后再应用。"); return; }
    setEditing(null); setError(null); setNotice("结果约定已应用到当前草稿，尚未保存或发布。");
    returnFocus.current = toggle.current;
    toggle.current?.focus();
  }

  function apply(event: MouseEvent<HTMLButtonElement>) {
    if (!editing) return;
    const result = applyNodeModelOutputDraft(node, editing.draft, editing.snapshot);
    if (!result.ok) { setError(result.error); return; }
    if (state.configured) {
      returnFocus.current = event.currentTarget;
      setConfirmation({ kind: "replace", ...editing, epoch, revision: memory?.entry?.revision ?? editingRevision.current });
    } else commit(editing.snapshot, editing.draft);
  }

  function confirm() {
    if (!confirmation) return;
    if (confirmation.epoch !== epoch || confirmation.revision !== (memory?.entry?.revision ?? editingRevision.current)
      || (confirmation.kind === "replace" && (stale || JSON.stringify(confirmation.draft) !== JSON.stringify(editing?.draft)))) {
      setError("草稿或本页填写已变化，原确认失效，原信息没有清除或覆盖，请重新核对。"); setConfirmation(null); return;
    }
    if (confirmation.kind === "clear") {
      const result = clearNodeModelOutput(node, confirmation.snapshot);
      if (!result.ok) setError(result.error);
      else if (onNodeChange(result.node) === false) setError("完整画布草稿未接受这次清除，原约定保持不变。请核对下方说明。");
      else { setEditing(null); setError(null); setNotice("结果约定已从当前草稿清除，尚未保存或发布。"); }
    } else commit(confirmation.snapshot, confirmation.draft);
    returnFocus.current = toggle.current;
    setConfirmation(null);
  }

  const schema = state.config?.schema;
  const properties = schema?.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? Object.keys(schema.properties) : [];

  return <section aria-label="模型结果字段约定" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <h3 className="text-sm font-semibold text-slate-950">模型结果字段约定</h3>
    <p className="text-xs leading-5 text-slate-600">约定这一步应返回的对象字段。字段校验与有限修正不证明业务质量，也不保证模型服务支持所选请求方式。修改只作用于当前草稿，仍需保存并发布。</p>
    <label className="flex items-center gap-2 text-sm text-slate-700"><input ref={toggle} type="checkbox" aria-label="使用结构化结果" checked={state.configured || editing !== null} disabled={!state.editable || stale} onChange={(event) => {
      setError(null); setNotice(null);
      if (event.target.checked) begin();
      else if (state.configured && currentSnapshot !== null) { returnFocus.current = event.currentTarget; setConfirmation({ kind: "clear", snapshot: currentSnapshot, epoch, revision: memory?.entry?.revision ?? editingRevision.current }); }
      else cancel();
    }} />使用结构化结果</label>
    {!state.configured && !editing ? <p className="text-xs text-slate-500">尚未设置字段约定，保留现有模型结果处理方式。打开开关不会自动写入约定。</p> : null}
    {state.issue ? <p role="alert" className="text-xs leading-5 text-amber-800">{state.issue}</p> : null}
    {state.config ? <dl className="grid gap-2 text-xs text-slate-600">
      <div><dt className="font-semibold text-slate-900">当前草稿字段</dt><dd>{properties.length ? properties.join("、") : "仅约定对象格式，尚未列出具体字段"}</dd></div>
      <div><dt className="font-semibold text-slate-900">当前请求方式</dt><dd>{state.config.providerMode === "json-schema" ? "向模型服务提交字段规则" : "按对象格式请求"}</dd></div>
      <div><dt className="font-semibold text-slate-900">格式修正次数</dt><dd>{state.config.maxRepairAttempts === 0 ? "不作格式修正" : `最多额外修正${state.config.maxRepairAttempts}次`}</dd></div>
    </dl> : null}
    {state.configured ? <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">开发者原字段规则（只读）</summary><textarea aria-label="原字段规则只读" readOnly value={savedText(state.config?.schema ?? node.modelOutput)} rows={7} className="mt-2 w-full rounded border border-slate-200 p-2 font-mono text-xs" /></details> : null}
    {state.configured && node.modelOutput?.mockOutput !== undefined ? <details className="rounded-lg border border-amber-200 p-3"><summary className="cursor-pointer text-xs font-semibold text-amber-900">开发者测试区：原模拟样例</summary><p className="mt-2 text-xs leading-5 text-amber-900">仅后端模拟模式采用此测试样例；它不是真实结果或默认模型输出。编辑结果约定时原样保留，仍须满足新的字段规则。</p><textarea aria-label="原模拟样例只读" readOnly value={savedText(node.modelOutput.mockOutput)} rows={5} className="mt-2 w-full rounded border border-slate-200 p-2 font-mono text-xs" /></details> : null}
    {state.editable && state.configured && !editing ? <button type="button" onClick={begin} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-indigo-700">编辑结果约定</button> : null}
    {editing ? <div className="space-y-3 rounded-lg border border-indigo-200 p-3">
      {stale ? <p role="alert" className="text-xs text-amber-800">步骤已发生变化，请取消编辑后重新打开；当前输入已保留，不能覆盖新草稿。</p> : null}
      <fieldset disabled={stale || !state.editable} className="space-y-3">
        <label className="block text-xs text-slate-600">请求方式<select aria-label="结果请求方式" value={editing.draft.providerMode} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, providerMode: event.target.value === "json-schema" ? "json-schema" : "json" } })} className="mt-1 block w-full rounded border border-slate-300 p-2"><option value="json">按对象格式请求</option><option value="json-schema">向模型服务提交字段规则</option></select></label>
        <label className="block text-xs text-slate-600">格式修正次数<select aria-label="额外格式修正次数" value={editing.draft.maxRepairAttempts} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, maxRepairAttempts: Number(event.target.value) } })} className="mt-1 block w-full rounded border border-slate-300 p-2">{Array.from({ length: MAX_MODEL_OUTPUT_REPAIRS + 1 }, (_, count) => <option key={count} value={count}>{count === 0 ? "不作格式修正" : `最多额外修正${count}次`}</option>)}</select></label>
        <details open className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">开发者字段规则编辑区</summary><p className="mt-2 text-xs leading-5 text-slate-600">根结构须为对象。数字、是非值、可选值和嵌套规则保持原类型；规则本身不生成业务结果。规则保存容量最多32KB。</p><textarea aria-label="结果字段规则" value={editing.draft.schemaText} maxLength={MAX_MODEL_OUTPUT_SCHEMA_BYTES * 4} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, schemaText: event.target.value } })} rows={10} spellCheck={false} className="mt-2 w-full rounded border border-slate-300 p-2 font-mono text-xs" /></details>
      </fieldset>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={stale || !state.editable} onClick={apply} className="min-h-9 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-50">应用到当前草稿</button><button type="button" onClick={cancel} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs text-slate-700">取消编辑</button></div>
    </div> : null}
    {error ? <div role="alert" className="text-xs leading-5 text-red-700"><p>结果约定未应用，原草稿已保留。</p><details className="mt-1"><summary className="cursor-pointer font-semibold">开发者校验说明</summary><p className="mt-1 break-words">{error}</p></details></div> : null}
    {notice ? <p role="status" className="text-xs text-indigo-700">{notice}</p> : null}
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }} title={confirmation?.kind === "clear" ? "清除当前结果约定？" : "替换当前结果约定？"} description={confirmation?.kind === "clear" ? "字段规则和原模拟样例将一起从当前草稿移除。此操作不修改已发布版本；确认前请核对依赖这些字段的后续步骤。" : "新的字段规则、请求方式和修正次数将替换当前草稿的约定；原模拟样例保留，不改写后续步骤或已发布版本。"} confirmLabel={confirmation?.kind === "clear" ? "确认清除约定" : "确认替换约定"} onConfirm={confirm} returnFocusRef={returnFocus} />
  </section>;
}
