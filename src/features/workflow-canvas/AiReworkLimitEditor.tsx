"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { aiReworkState, createAiReworkRequest, createAiReworkResetRequest, type AiReworkEdit, type AiReworkRequest, type AiReworkResetRequest } from "./ai-rework-editing";
import type { ContractEditorMemory } from "./use-node-contract-edits";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

type Editing = AiReworkEdit & { epoch: number };
type Confirmation = { request: AiReworkRequest | AiReworkResetRequest; epoch: number; editingRevision: number; memoryRevision?: number };

export function AiReworkLimitEditor({ originalDraft, nodeId, revision, onApply, onReset, memory, source = "saved" }: {
  originalDraft: unknown;
  nodeId: string;
  revision: number;
  onApply: (request: AiReworkRequest) => boolean;
  onReset?: (request: AiReworkResetRequest) => boolean;
  memory?: ContractEditorMemory<AiReworkEdit>;
  source?: "saved" | "draft";
}) {
  const state = useMemo(() => aiReworkState(originalDraft, nodeId), [originalDraft, nodeId]);
  const context = JSON.stringify([nodeId, revision, state.snapshot]);
  const [observed, setObserved] = useState({ context, epoch: 0 });
  const localEpoch = observed.context === context ? observed.epoch : observed.epoch + 1;
  if (observed.context !== context) setObserved({ context, epoch: localEpoch });
  const epoch = memory?.epoch ?? localEpoch;
  const [localEditing, setLocalEditing] = useState<Editing | null>(null);
  const hasMemory = memory !== undefined;
  const entry = memory?.entry;
  const editing = useMemo<Editing | null>(() => hasMemory ? entry ? { ...entry.value, epoch: entry.epoch } : null : localEditing, [hasMemory, entry, localEditing]);
  const editingRef = useRef(editing);
  useLayoutEffect(() => { editingRef.current = editing; }, [editing]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editingRevision = useRef(0);
  const returnFocus = useRef<HTMLButtonElement>(null);
  const revisionValid = Number.isSafeInteger(revision) && revision >= 0;
  const stale = editing !== null && (editing.base !== context || editing.epoch !== epoch);
  const editable = state.editable && revisionValid;

  function setEditing(next: Editing | null) {
    editingRef.current = next;
    if (memory) {
      if (next) { const { epoch: ignoredEpoch, ...value } = next; void ignoredEpoch; memory.change(value); }
      else memory.discard();
    } else setLocalEditing(next);
  }

  function begin() {
    if (!editable) return;
    editingRevision.current += 1;
    setError(null); setNotice(null); setConfirmation(null);
    setEditing({ base: context, epoch, title: state.node?.title || "当前智能处理步骤", attempts: state.attempts === null ? "" : String(state.attempts), backoff: state.backoff === null ? "" : String(state.backoff), configured: state.configured });
  }
  function update(field: "attempts" | "backoff", value: string) {
    editingRevision.current += 1;
    const current = editingRef.current;
    setEditing(current ? { ...current, [field]: value } : null);
    setError(null); setNotice(null);
  }
  function cancel() {
    editingRevision.current += 1;
    setEditing(null); setConfirmation(null); setError(null); setNotice(null);
  }
  function requestApply() {
    if (!editing || stale || !editable) return;
    const result = createAiReworkRequest(originalDraft, nodeId, revision, editing.attempts, editing.configured ? undefined : editing.backoff);
    if (!result.ok) { setError(result.error); return; }
    setError(null);
    setConfirmation({ request: result.request, epoch, editingRevision: editingRevision.current, memoryRevision: memory?.entry?.revision });
  }
  function requestReset() {
    if (!editing || stale || !editable || !onReset) return;
    const result = createAiReworkResetRequest(originalDraft, nodeId, revision);
    if (!result.ok) { setError(result.error); return; }
    setError(null);
    setConfirmation({ request: result.request, epoch, editingRevision: editingRevision.current, memoryRevision: memory?.entry?.revision });
  }
  function confirm() {
    const requested = confirmation;
    setConfirmation(null);
    if (!editing || !requested || stale || !editable || requested.epoch !== epoch || requested.editingRevision !== editingRevision.current || requested.memoryRevision !== memory?.entry?.revision) {
      setError("完整草稿或本页填写已经变化，原确认失效；填写仍保留，请重新核对。"); return;
    }
    const current = "action" in requested.request ? createAiReworkResetRequest(originalDraft, nodeId, revision)
      : createAiReworkRequest(originalDraft, nodeId, revision, editing.attempts, editing.configured ? undefined : editing.backoff);
    if (!current.ok || JSON.stringify(current.request) !== JSON.stringify(requested.request)) {
      setError(current.ok ? "原确认已失效，请重新核对后再应用。" : current.error); return;
    }
    let accepted = false;
    try { accepted = "action" in current.request ? onReset?.(current.request) === true : onApply(current.request) === true; }
    catch { setError("画布接收这次修改时发生异常，填写仍保留，未显示应用成功。"); return; }
    if (!accepted) { setError("完整画布草稿没有明确接受这次修改，原值与填写均保留；请核对后再应用。"); return; }
    editingRevision.current += 1;
    setEditing(null); setError(null);
    setNotice("action" in current.request
      ? "画布已明确接收移除次数和等待参数；未设置时当前质量检查默认最多额外返工一次。仍需保存并发布，本页未执行，也未恢复旧版本设置。"
      : "画布已明确接收这次尝试设置，仍需通过画布保存并发布；本页没有执行任务。");
  }

  return <section aria-label="智能处理自动返工上限" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <h3 className="text-sm font-semibold text-slate-950">智能处理自动返工上限</h3>
    <p className="text-xs leading-5 text-slate-600">只针对交付前检查中必需结果缺失时的智能处理返工。总尝试次数包含首次处理，1 次表示不返工；这不等于网络重试或整个任务的失败恢复策略。</p>
    {source === "draft" ? <p className="text-xs leading-5 text-slate-500">以下是当前画布设置，可能包含本地修改；不是已保存或已发布的确认。</p> : null}
    {state.configured && state.attempts !== null ? <p className="text-xs leading-5 text-slate-700">{source === "draft" ? "当前画布总尝试上限" : "原稿已保存总尝试上限"}：{state.attempts} 次，最多额外返工 {Math.max(0, state.attempts - 1)} 次。原等待参数保持 {state.backoff} 毫秒；当前自动返工不按这个参数等待。</p> : state.editable ? <p className="text-xs leading-5 text-slate-600">{source === "draft" ? "当前画布没有尝试设置。" : "原稿没有保存尝试设置。"}当前执行器在缺失必需结果时默认最多额外返工一次；这个默认不会写回原稿。</p> : null}
    {state.issue ? <p role="alert" className="text-xs leading-5 text-amber-900">{state.issue}</p> : null}
    {!revisionValid ? <p role="alert" className="text-xs leading-5 text-amber-900">当前草稿修订未知，不能确认修改；原稿保持不变。</p> : null}
    {!editing && editable ? <button type="button" onClick={begin} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-indigo-700">{state.configured ? "编辑返工上限" : "设置返工上限"}</button> : null}
    {editing ? <div className="space-y-3 rounded-lg border border-indigo-200 p-3">
      <p className="break-words text-xs leading-5 text-slate-600">本页填写属于「{redactSensitiveText(editing.title).split(nodeId).join("[内部标识已隐藏]")}」，尚未应用。</p>
      {stale ? <p role="alert" className="text-xs leading-5 text-amber-900">草稿或步骤已经变化，原填写仍保留但不能覆盖当前草稿。请取消本页填写后重新打开。</p> : null}
      <fieldset disabled={stale || !editable} className="space-y-3">
        <label className="block text-xs font-medium text-slate-700">包含首次处理的总尝试次数<input aria-label="包含首次处理的总尝试次数" inputMode="numeric" maxLength={16} value={editing.attempts} onChange={(event) => update("attempts", event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm disabled:bg-slate-50" /><span className="mt-1 block font-normal text-slate-500">填写 1–8 的整数；填写 1 时，不自动返工。</span></label>
        {!editing.configured ? <label className="block text-xs font-medium text-slate-700">新设置所需的等待参数（毫秒）<input aria-label="新设置所需的等待参数（毫秒）" inputMode="numeric" maxLength={16} value={editing.backoff} onChange={(event) => update("backoff", event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm disabled:bg-slate-50" /><span className="mt-1 block font-normal leading-5 text-slate-500">原稿没有此参数，须明确填写 50–60000 的整数才能形成完整尝试设置。本页不补造默认值；当前自动返工不按此参数等待。</span></label> : null}
      </fieldset>
      <div className="flex flex-wrap gap-2"><button ref={returnFocus} type="button" disabled={stale || !editable} onClick={requestApply} className="min-h-9 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-50">应用到画布草稿</button>{onReset && state.resettable ? <button type="button" disabled={stale || !editable} onClick={requestReset} className="min-h-9 rounded-lg border border-amber-300 px-3 text-xs font-semibold text-amber-900 disabled:opacity-50">恢复质量返工默认设置</button> : null}<button type="button" onClick={cancel} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs text-slate-700">取消本页填写</button></div>
      {onReset && state.configured ? <p className="text-xs leading-5 text-slate-500">{state.resetIssue ?? "恢复默认会移除已设置次数和等待参数，并丢弃本类未应用填写；未设置时当前质量检查最多额外返工一次，不等于禁止返工，也不恢复旧版本。"}</p> : null}
    </div> : null}
    {error ? <p role="alert" className="text-xs leading-5 text-amber-900">{error}</p> : null}
    {notice ? <p role="status" className="text-xs leading-5 text-indigo-800">{notice}</p> : null}
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }}
      title={confirmation && "action" in confirmation.request ? "移除设置并恢复当前质量返工默认？" : "确认应用自动返工上限？"}
      description={confirmation && "action" in confirmation.request ? "将移除当前步骤的次数和等待参数，并丢弃本类尚未应用的次数填写。未设置时，当前质量检查在缺失必需结果时最多额外返工一次；这不等于禁止返工，也不是旧版本原设置。其他配置与未应用填写保留，仍须通过画布保存并发布；本页不执行任务。" : "仅改变当前智能处理步骤的尝试设置，可能改变缺失结果时是否返工。画布须按当前完整原稿重新校验并明确接受；本页不会保存、发布或运行。"}
      confirmLabel={confirmation && "action" in confirmation.request ? "确认恢复质量返工默认" : "确认应用返工上限"} onConfirm={confirm} tone="warning" returnFocusRef={returnFocus} />
  </section>;
}
