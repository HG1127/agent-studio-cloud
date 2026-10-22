"use client";

import { useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  beginQualityGateRulesEdit, createQualityGateRulesRemovalRequest, createQualityGateRulesRequest, qualityGateRulesState,
  type QualityGateRulesEdit, type QualityGateRulesInput, type QualityGateRulesMemory, type QualityGateRulesMemoryVersion, type QualityGateRulesRequest,
} from "./quality-gate-rules-editing";
import { qualityDisplay } from "./quality-display";

type Confirmation = { request: QualityGateRulesRequest; edit: string; epoch: number; inputRevision: number; memoryEpoch?: number };

export function QualityGateRulesEditor({ canvasDraft, nodeId, revision, sourcesComplete, onApply, memory, showCurrentSummary = true }: {
  canvasDraft: unknown;
  nodeId: string;
  revision: number;
  sourcesComplete: boolean;
  onApply: (request: QualityGateRulesRequest) => boolean;
  memory?: QualityGateRulesMemory;
  showCurrentSummary?: boolean;
}) {
  const state = useMemo(() => qualityGateRulesState(canvasDraft, nodeId, sourcesComplete), [canvasDraft, nodeId, sourcesComplete]);
  const context = JSON.stringify([nodeId, revision, state.snapshot, sourcesComplete, memory?.epoch ?? null]);
  const [observed, setObserved] = useState({ context, epoch: 0 });
  const epoch = observed.context === context ? observed.epoch : observed.epoch + 1;
  if (observed.context !== context) setObserved({ context, epoch });
  const [local, setLocal] = useState<{ edit: QualityGateRulesEdit; epoch: number } | null>(null);
  const editing = memory ? memory.entry?.value ?? null : local?.edit ?? null;
  const display = useMemo(() => qualityDisplay(canvasDraft, editing?.nodeId ?? nodeId), [canvasDraft, editing?.nodeId, nodeId]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRevision = useRef(0);
  const returnFocus = useRef<HTMLButtonElement>(null);
  const revisionValid = Number.isSafeInteger(revision) && revision >= 0;
  const memoryValid = !memory || Number.isSafeInteger(memory.epoch) && memory.epoch >= 0;
  const editable = state.editable && revisionValid && memoryValid;
  const stale = editing !== null && (editing.nodeId !== nodeId || editing.revision !== revision || editing.snapshot !== state.snapshot
    || (memory ? memory.entry?.epoch !== memory.epoch : local?.epoch !== epoch));

  function memoryVersion(): QualityGateRulesMemoryVersion | undefined {
    return memory?.entry ? { epoch: memory.entry.epoch, revision: memory.entry.revision, generation: memory.entry.generation } : undefined;
  }
  function write(edit: QualityGateRulesEdit) {
    inputRevision.current += 1;
    setLocal({ edit, epoch });
    memory?.change(edit);
    setError(null); setNotice(null);
  }
  function begin() {
    if (!editable) return;
    const result = beginQualityGateRulesEdit(canvasDraft, nodeId, revision, sourcesComplete);
    if (!result.ok) { setError(result.error); return; }
    setConfirmation(null); write(result.edit);
  }
  function update(input: QualityGateRulesInput) {
    if (!editing || stale || !editable) return;
    write({ ...editing, input });
  }
  function cancel() {
    inputRevision.current += 1;
    memory?.discard(memoryVersion());
    setLocal(null); setConfirmation(null); setError(null); setNotice(null);
  }
  function ask(action: "apply" | "remove" = "apply") {
    if (!editing || stale || !editable) return;
    const create = action === "remove" ? createQualityGateRulesRemovalRequest : createQualityGateRulesRequest;
    const result = create(canvasDraft, nodeId, revision, sourcesComplete, editing, memoryVersion());
    if (!result.ok) { setError(result.error); return; }
    setError(null);
    setConfirmation({ request: result.request, edit: JSON.stringify(editing), epoch, inputRevision: inputRevision.current, ...(memory ? { memoryEpoch: memory.epoch } : {}) });
  }
  function confirm() {
    const requested = confirmation;
    setConfirmation(null);
    if (!requested || !editing || stale || !editable || requested.epoch !== epoch || requested.inputRevision !== inputRevision.current
      || requested.memoryEpoch !== memory?.epoch || requested.edit !== JSON.stringify(editing)) {
      setError("完整草稿或本页填写已经变化，原确认失效；填写仍保留，请重新核对。"); return;
    }
    const create = requested.request.action === "remove" ? createQualityGateRulesRemovalRequest : createQualityGateRulesRequest;
    const result = create(canvasDraft, nodeId, revision, sourcesComplete, editing, memoryVersion());
    if (!result.ok || JSON.stringify(result.request) !== JSON.stringify(requested.request)) {
      setError(result.ok ? "填写版本已经变化，原确认失效；当前填写仍保留。" : result.error); return;
    }
    let accepted = false;
    try { accepted = onApply(result.request) === true; }
    catch { setError("画布接收时发生异常，填写仍保留，未显示应用成功。"); return; }
    if (!accepted) { setError("完整画布没有明确接受这组规则，填写仍保留；请核对当前草稿后再应用。"); return; }
    inputRevision.current += 1;
    memory?.discard(requested.request.memory);
    setLocal(null); setError(null);
    setNotice(requested.request.action === "remove"
      ? "画布已明确接收移除，下一次执行将按已有业务判断设置调用模型；仍需通过画布保存并发布，本页未执行。"
      : "画布已明确接收质量规则，仍需通过画布保存并发布；本页没有执行检查。");
  }

  const available = state.sources.filter((source) => source.state === "available");
  const selected = editing?.input.requiredOutputTitles ?? [];
  const unavailable = selected.flatMap((title, index) => {
    const source = state.sources.find((item) => item.title === title);
    return source?.state === "available" ? [] : [{ index, title: source?.displayTitle ?? "无法核对的原引用", note: source?.note ?? "这项原引用当前无法核对；仍保留，不能替换成猜测的来源。" }];
  });

  return <section aria-label="交付前质量规则编辑" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <h3 className="text-sm font-semibold text-slate-950">交付前质量规则</h3>
    <p className="text-xs leading-5 text-slate-600">这里编辑当前画布有效设置。详情读取可能已补入默认值，不能据此判断原保存字段；原始设置须在版本快照中核对。</p>
    {state.node ? <p className="break-words text-xs text-slate-700">当前步骤：{display(state.node.title.trim() || "未命名步骤")}</p> : null}
    {state.quality && showCurrentSummary ? <dl className="space-y-2 text-xs leading-5 text-slate-700">
      <div><dt className="font-semibold">当前要求形成结果的来源</dt><dd className="break-words">{state.references.length ? state.references.map((source) => display(source.displayTitle)).join("、") : "未指定单独来源，按可检查的业务步骤统计"}</dd></div>
      <div><dt className="font-semibold">当前最低有效结果数量</dt><dd>{state.quality.minOutputCount} 项</dd></div>
      <div><dt className="font-semibold">已执行工具的回执</dt><dd>{state.quality.checkToolReceipts ? "要求核对" : "未要求核对"}</dd></div>
      <div><dt className="font-semibold">已执行人工步骤的决定</dt><dd>{state.quality.checkHumanBoundary ? "要求核对" : "未要求核对"}</dd></div>
    </dl> : !state.quality && state.editable ? <p className="text-xs leading-5 text-slate-600">当前画布没有质量规则。打开填写不会新增规则，须完整核对并确认应用。</p> : null}
    {state.extraFields ? <p className="text-xs text-slate-500">当前质量设置还有 {state.extraFields} 项额外字段，修改四项规则时仍保留。</p> : null}
    {state.issue ? <p role="alert" className="text-xs leading-5 text-amber-900">{state.issue}</p> : null}
    {state.referenceIssue ? <p role="alert" className="text-xs leading-5 text-amber-900">{state.referenceIssue}</p> : null}
    {!revisionValid || !memoryValid ? <p role="alert" className="text-xs text-amber-900">当前草稿或填写修订不可核对，不能确认修改。</p> : null}
    {!editing && editable ? <button type="button" onClick={begin} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-indigo-700">{state.configured ? "编辑质量规则" : "填写质量规则"}</button> : null}
    {editing ? <div className="space-y-3 rounded-lg border border-indigo-200 p-3">
      <p className="break-words text-xs leading-5 text-slate-600">以下填写属于「{display(editing.title.trim() || "未命名步骤")}」，尚未应用。</p>
      {stale ? <p role="alert" className="text-xs leading-5 text-amber-900">草稿、步骤或填写归属已经变化，原填写仍保留但不能覆盖当前画布；请取消后重新打开。</p> : null}
      <fieldset disabled={stale || !editable} className="space-y-3">
        <fieldset className="space-y-2"><legend className="text-xs font-semibold text-slate-700">必须形成结果的来源步骤</legend>
          <p className="text-xs leading-5 text-slate-500">只选择完整标题唯一的顶层业务步骤；定义可选不代表运行已执行。未选择来源时仍按最低数量检查，最低数量为 0 则没有有效结果数量要求。</p>
          {available.length ? available.map((source) => <label key={source.nodeId} className="flex items-start gap-2 break-words text-xs leading-5 text-slate-700"><input type="checkbox" aria-label={"必须形成结果：" + display(source.displayTitle)} checked={selected.includes(source.title)} onChange={(event) => update({ ...editing.input, requiredOutputTitles: event.target.checked ? [...selected, source.title] : selected.filter((title) => title !== source.title) })} />{display(source.displayTitle)}</label>) : <p className="text-xs text-slate-500">当前没有可唯一选择的业务结果来源。</p>}
          {unavailable.length ? <ul className="space-y-2">{unavailable.map((source) => <li key={source.index} className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900"><p className="break-words">{display(source.title)} · 第 {source.index + 1} 项原引用</p><p>{source.note}</p><button type="button" aria-label={"移除不能采用的第 " + (source.index + 1) + " 项原引用"} onClick={() => update({ ...editing.input, requiredOutputTitles: selected.filter((_, index) => index !== source.index) })} className="mt-2 min-h-9 rounded border border-amber-200 px-3 font-semibold">明确移除这项引用</button></li>)}</ul> : null}
          {selected.length > new Set(selected).size ? <p className="text-xs text-amber-900">填写中含重复来源，重复引用不增加有效结果数量；取消该来源选择会移除它的全部重复引用。</p> : null}
          {state.sources.some((source) => source.state !== "available") ? <p className="text-xs leading-5 text-slate-500">重名、隐藏控制步骤、不产出业务结果的类型和标题无效的步骤未列为可选来源。</p> : null}
        </fieldset>
        <label className="block text-xs font-medium text-slate-700">最低有效结果数量<input aria-label="最低有效结果数量" inputMode="numeric" maxLength={16} value={editing.input.minOutputCountText} onChange={(event) => update({ ...editing.input, minOutputCountText: event.target.value })} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm" /><span className="mt-1 block font-normal text-slate-500">填写 0–200 的整数。指定来源时不得超过去重后的来源数量。</span></label>
        <label className="flex items-start gap-2 text-xs leading-5 text-slate-700"><input type="checkbox" aria-label="核对已执行工具的回执" checked={editing.input.checkToolReceipts} onChange={(event) => update({ ...editing.input, checkToolReceipts: event.target.checked })} />核对已执行工具的回执</label>
        <label className="flex items-start gap-2 text-xs leading-5 text-slate-700"><input type="checkbox" aria-label="核对已执行人工步骤的决定" checked={editing.input.checkHumanBoundary} onChange={(event) => update({ ...editing.input, checkHumanBoundary: event.target.checked })} />核对已执行人工步骤的决定</label>
      </fieldset>
      <div className="flex flex-wrap gap-2"><button ref={returnFocus} type="button" disabled={stale || !editable} onClick={() => ask()} className="min-h-9 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-50">应用质量规则到画布</button>{state.removable ? <button type="button" disabled={stale || !editable} onClick={() => ask("remove")} className="min-h-9 rounded-lg border border-amber-300 px-3 text-xs font-semibold text-amber-900">移除质量规则并改走业务判断</button> : null}<button type="button" onClick={cancel} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs text-slate-700">取消质量填写</button></div>
      {state.removable ? <p className="text-xs leading-5 text-amber-900">移除会删除整个质量对象，但保留当前已有的业务判断类别；下一次执行会调用模型作业务判断，不能当成仍有交付检查。</p> : state.configured && state.removalIssue ? <p className="text-xs leading-5 text-slate-500">{state.removalIssue}</p> : null}
    </div> : null}
    {error ? <p role="alert" className="text-xs leading-5 text-amber-900">{error}</p> : null}
    {notice ? <p role="status" className="text-xs leading-5 text-indigo-800">{notice}</p> : null}
    <p className="text-xs leading-5 text-slate-500">规则会影响缺失结果时是否停止或要求返工。人工拒绝的收尾可能保留当前结果；检查通过不等于交付获批准。本页不会保存、发布或执行。</p>
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }} title={confirmation?.request.action === "remove" ? "确认移除质量规则并改走业务判断？" : "确认应用这组质量规则？"} description={confirmation?.request.action === "remove" ? "将删除整个质量对象，保留当前已有的业务判断类别和其他配置。下一次执行会按该类别调用模型，不再按这里的交付质量规则检查；不会把默认质量规则重新补为已保存。父层仍须核对最新完整草稿与填写版本，本页不执行。" : "将四项质量设置交给当前完整画布草稿。改变来源、降低数量或取消核对会改变检查范围；父层须核对最新草稿和填写版本并明确接受。本页不会保存、发布或执行。"} confirmLabel={confirmation?.request.action === "remove" ? "确认移除并改走业务判断" : "确认应用质量规则"} onConfirm={confirm} tone="warning" returnFocusRef={returnFocus} />
  </section>;
}
