"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ClipboardCheck, Columns2, Eraser, Rows3 } from "lucide-react";
import type { AgentInputField } from "@/contracts/manifest";
import type { AgentTargetOption } from "@/contracts/agent";
import type { WorkflowVariable } from "@/contracts/workflow";
import { MAX_RUN_INPUT_BYTES } from "@/contracts/run";
import { inputFieldDescription } from "@/features/agents/input-field-description";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { inspectPreviewInput, preparePreviewInput, previewInputCapacity, type PreviewInputInspection } from "./preview-input";
import { webToolInputLabel } from "./web-tool-field-label";
import { WebToolTrialRun } from "./WebToolTrialRun";
import { StructuredInputEditor } from "@/features/inputs/StructuredInputEditor";
import { useStructuredInputSession } from "@/features/inputs/use-structured-input-session";

const INPUT_TYPES = { string: "文字", number: "数字", boolean: "是或否", object: "对象", array: "列表" } as const;

export function WebToolInputPreview({ fields, inputDefinitions = [], trialTarget }: { fields: AgentInputField[]; inputDefinitions?: WorkflowVariable[]; trialTarget?: AgentTargetOption }) {
  return <WebToolInputPreviewSession key={trialTarget ? `${trialTarget.agentId}:${trialTarget.versionId}` : JSON.stringify(fields)} fields={fields} inputDefinitions={inputDefinitions} trialTarget={trialTarget} />;
}

function WebToolInputPreviewSession({ fields, inputDefinitions, trialTarget }: { fields: AgentInputField[]; inputDefinitions: WorkflowVariable[]; trialTarget?: AgentTargetOption }) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [check, setCheck] = useState<PreviewInputInspection | null>(null);
  const [columns, setColumns] = useState<1 | 2>(2);
  const [clearOpen, setClearOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const pendingCheck = useRef(false);
  const structured = useStructuredInputSession(fields, () => lockedRef.current);
  const values = structured.values;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const requiredIndexes = fields.flatMap((field, index) => field.required ? [index] : []);
  const missingRequired = requiredIndexes.filter((index) => !(values[fields[index].name] ?? "").trim());
  const capacity = previewInputCapacity(fields, values);

  function update(name: string, value: string) {
    if (!structured.update(name, value)) return;
    if (check) refreshCheck();
  }

  function apply(name: string, nextText: string, revision: number) {
    if (!structured.apply(name, nextText, revision)) return false;
    if (check) refreshCheck();
    return true;
  }

  function pendingInspection(index: number) {
    return { checkedFields: 0, issues: [{ fieldIndex: index, error: `${webToolInputLabel(fields[index], index)}还有尚未应用的填写。请确认应用或取消该项草稿；没有提交任务。` }], input: null };
  }

  function refreshCheck() {
    const index = structured.firstPendingIndex();
    pendingCheck.current = index !== null;
    setCheck(index !== null ? pendingInspection(index) : inspectPreviewInput(fields, structured.valuesRef.current));
  }

  function reportDraft(name: string, owner: string, revision: number, draftPending: boolean) {
    structured.reportPending(name, owner, revision, draftPending);
    if (!draftPending && pendingCheck.current && !lockedRef.current) {
      const index = structured.firstPendingIndex();
      if (index === null) { pendingCheck.current = false; setCheck(null); }
      else setCheck(pendingInspection(index));
    }
  }

  function focusField(index: number) {
    form.current?.querySelector<HTMLElement>(`[data-preview-field-index="${index}"]`)?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lockedRef.current) return;
    inspect();
  }

  function inspect() {
    const draftIndex = structured.firstPendingIndex();
    if (draftIndex !== null) {
      pendingCheck.current = true;
      const inspected = pendingInspection(draftIndex);
      setCheck(inspected);
      focusField(draftIndex);
      return inspected;
    }
    pendingCheck.current = false;
    const inspected = preparePreviewInput(fields, structured.valuesRef.current);
    setCheck(inspected);
    const first = inspected.issues.find((issue) => issue.fieldIndex !== null);
    if (first?.fieldIndex !== undefined && first.fieldIndex !== null) focusField(first.fieldIndex);
    return inspected;
  }

  function clear() { if (lockedRef.current) return; structured.reset(); pendingCheck.current = false; setCheck(null); setClearOpen(false); }

  function lock(locked: boolean) { lockedRef.current = locked; setLocked(locked); }

  return <section aria-labelledby={`${id}-title`} className="content-card min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><ClipboardCheck aria-hidden="true" className="size-4" /></span>
        <div><h2 id={`${id}-title`} className="section-title">网页填写预览</h2><p className="mt-1 text-sm leading-6 text-slate-600">{trialTarget ? "按所选已保存版本的字段试填与核对格式。检查格式不会提交；只有另行确认内部试运行才会创建真实任务。" : "按所选已保存版本的字段试填与核对格式。只在本页显示，不会保存、运行助手或生成结果。"}</p></div>
      </div>
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">仅本页预览</span>
    </div>
    {fields.length ? <form ref={form} onSubmit={submit} noValidate className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
        <p className="text-xs text-slate-600">本版本共 {fields.length} 项输入，其中 {fields.filter((field) => field.required).length} 项必填。</p>
        <div role="group" aria-label="试填布局" className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {[{ value: 1 as const, label: "单列填写", Icon: Rows3 }, { value: 2 as const, label: "双列填写", Icon: Columns2 }].map(({ value, label, Icon }) => <button key={value} type="button" disabled={locked} aria-pressed={columns === value} onClick={() => setColumns(value)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50 ${columns === value ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}><Icon aria-hidden="true" className="size-3.5" />{label}</button>)}
        </div>
      </div>
      <p aria-label="全部输入容量" aria-live="polite" className={"rounded-lg px-3 py-2 text-xs leading-5 " + (capacity !== null && capacity > MAX_RUN_INPUT_BYTES ? "bg-amber-50 text-amber-950" : "bg-slate-50 text-slate-600")}>
        {capacity === null ? "请先补齐必填项并核对填写格式，才能计算全部输入的准确容量。" : "待提交输入占用 " + capacity + " / " + MAX_RUN_INPUT_BYTES + " 字节。"}
        {capacity !== null && capacity > MAX_RUN_INPUT_BYTES ? " 已超过总容量限制；完整填写仍保留在本页，不会据此启动任务。" : " 总容量按实际提交数据的编码计算，包含字段名、转义和数据结构；上限 " + MAX_RUN_INPUT_BYTES + " 字节。字符数不是容量，也不代表格式或业务内容通过。"}
      </p>
      {requiredIndexes.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <p aria-live="polite">已填写 {requiredIndexes.length - missingRequired.length} / {requiredIndexes.length} 项必填；填写进度不代表格式或业务内容通过。</p>
        {missingRequired.length > 0 ? <button type="button" disabled={locked} onClick={() => focusField(missingRequired[0])} className="rounded-md px-2 py-1 font-semibold text-indigo-700 underline underline-offset-4 disabled:opacity-50">定位下一项未填必填</button> : null}
      </div> : null}
      <div className={`grid gap-4 ${columns === 2 ? "lg:grid-cols-2" : "grid-cols-1"}`}>{fields.map((field, index) => {
        const issue = check?.issues.find((item) => item.fieldIndex === index);
        const hintId = `${id}-hint-${index}`;
        const errorId = `${id}-error-${index}`;
        const description = inputFieldDescription(field, inputDefinitions);
        const descriptionId = `${id}-description-${index}`;
        const control = {
          id: `${id}-field-${index}`,
          "data-preview-field-index": index,
          "aria-required": field.required,
          "aria-invalid": Boolean(issue),
          "aria-describedby": [hintId, description ? descriptionId : null, issue ? errorId : null].filter(Boolean).join(" "),
          value: values[field.name] ?? "",
          disabled: locked,
        };
        const style = `min-w-0 rounded-lg border bg-white px-3 text-sm outline-none focus:ring-2 ${issue ? "border-amber-500 focus:border-amber-600 focus:ring-amber-100" : "border-slate-200 focus:border-indigo-400 focus:ring-indigo-100"}`;
        return <div key={field.name} className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={control.id} className="break-words text-sm font-medium text-slate-800">{webToolInputLabel(field, index)}<span className="ml-1 text-xs font-normal text-slate-500">（{field.required ? "必填" : "选填"}）</span></label>
          <p id={hintId} className="text-xs leading-5 text-slate-500">{INPUT_TYPES[field.type]}{field.type === "object" ? "，使用大括号包裹内容" : field.type === "array" ? "，使用方括号包裹内容" : field.type === "string" ? "，可以分行填写" : ""}</p>
          {description ? <p id={descriptionId} className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">{description}</p> : null}
          {field.type === "boolean" ? <select {...control} onChange={(event) => update(field.name, event.target.value)} className={`h-11 ${style}`}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>
            : field.type === "number" ? <input {...control} type="text" inputMode="decimal" onChange={(event) => update(field.name, event.target.value)} placeholder="填写数字" className={`h-11 ${style}`} />
            : <textarea {...control} onChange={(event) => update(field.name, event.target.value)} rows={expanded[field.name] ? 8 : 3} placeholder={field.type === "object" ? "用 { } 包裹结构化内容" : field.type === "array" ? "用 [ ] 包裹列表内容" : "填写内容"} className={`resize-y py-2 ${style}`} />}
          {field.type === "object" || field.type === "array" ? <>
            <p className="text-xs leading-5 text-slate-500">上方保留专业格式填写；下方可逐项编辑或导入。修改上方内容会替换该项尚未应用的本地草稿。</p>
            <StructuredInputEditor field={field} label={webToolInputLabel(field, index)} value={values[field.name] ?? ""}
              revision={structured.revisions[field.name] ?? 0} disabled={locked}
              onApply={(nextText, revision) => apply(field.name, nextText, revision)}
              onPendingChange={(owner, revision, draftPending) => reportDraft(field.name, owner, revision, draftPending)} />
          </> : null}
          {field.type !== "boolean" ? <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">已填写 {(values[field.name] ?? "").length} 个字符</p>
            {field.type !== "number" ? <button type="button" disabled={locked} aria-controls={control.id} aria-label={`${expanded[field.name] ? "收起" : "展开"}第 ${index + 1} 项填写区`} onClick={() => setExpanded((current) => ({ ...current, [field.name]: !current[field.name] }))} className="rounded-md px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">{expanded[field.name] ? "收起填写区" : "展开填写区"}</button> : null}
          </div> : null}
          {issue ? <p id={errorId} className="text-xs font-medium leading-5 text-amber-900">{issue.error}</p> : null}
        </div>;
      })}</div>
      {structured.pendingCount > 0 ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">有 {structured.pendingCount} 项本地填写尚未应用。请逐项确认应用或取消，再检查格式或确认试运行。</p> : null}
      {structured.applied ? <p aria-label="结构化填写状态" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">结构化内容已应用到当前填写，尚未提交任务或保存版本。</p> : null}
      {structured.draftError ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">{structured.draftError}</p> : null}
      {check ? check.issues.length === 0 ? <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-900"><CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0" />已核对 {check.checkedFields} 项填写格式；没有提交或运行任务。</p>
        : <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">有 {check.issues.length} 处填写需要修改</p><p className="mt-1 text-xs leading-5">点击具体问题可返回对应输入；这里只核对填写格式，不验证业务内容或工具执行。</p><ul className="mt-2 space-y-1.5">{check.issues.map((issue, index) => <li key={index}>{issue.fieldIndex === null ? <p>{issue.error}</p> : <button type="button" onClick={() => focusField(issue.fieldIndex!)} className="text-left text-sm font-medium underline decoration-amber-400 underline-offset-4">{issue.error}</button>}</li>)}</ul></div> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={locked} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><ClipboardCheck aria-hidden="true" className="size-4" />检查填写格式</button>
        <button type="button" disabled={locked} onClick={() => Object.values(structured.valuesRef.current).some((value) => value.length > 0) || structured.firstPendingIndex() !== null ? setClearOpen(true) : clear()} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Eraser aria-hidden="true" className="size-4" />清空试填</button>
      </div>
      <p className="text-xs leading-5 text-slate-500">布局选择不会修改所选已保存版本，也不会保存为网页工具的展示配置。</p>
    </form> : <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">这个版本没有结构化输入字段，无法据此预览网页填写表单。请先核对助手的输入契约。</p>}
    <p className="mt-4 text-xs leading-5 text-slate-500">{trialTarget ? "没有确认试运行的填写只保留在当前页面内；请勿输入真实密钥或敏感资料。内部试运行使用助手任务记录，不代表网页工具已对外开放。" : "试填内容只保留在当前页面内；请勿输入真实密钥或敏感资料。正式网页工具的访问、运行与结果展示仍需服务端接口。"}</p>
    {trialTarget ? <WebToolTrialRun target={trialTarget} prepare={inspect} onLockedChange={lock} /> : null}
    <ConfirmDialog open={clearOpen} onOpenChange={setClearOpen} title="清空当前试填内容？" description="这些内容没有保存。清空后无法恢复，但不会修改助手版本或运行记录。" confirmLabel="确认清空试填" onConfirm={clear} pending={locked} tone="warning" />
  </section>;
}
