"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, ClipboardCheck, Eraser, LockKeyhole } from "lucide-react";
import type { AgentInputField } from "@/contracts/manifest";
import { checkPreviewInput, type PreviewInputCheck } from "./preview-input";

function fieldLabel(field: AgentInputField, index: number) {
  return field.label?.trim() || `业务信息 ${index + 1}`;
}

export function WebToolInputPreview({ fields }: { fields: AgentInputField[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<PreviewInputCheck | null>(null);

  function update(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setCheck(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCheck(checkPreviewInput(fields, values));
  }

  return <section aria-labelledby="web-tool-preview-title" className="content-card min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><ClipboardCheck className="size-4" /></span><div><h2 id="web-tool-preview-title" className="section-title">网页填写预览</h2><p className="mt-1 text-sm leading-6 text-slate-600">按正式版本的字段试填与核对格式。只在本页显示，不会保存、运行助手或生成结果。</p></div></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">仅本页预览</span></div>
    {fields.length ? <form onSubmit={submit} noValidate className="mt-5 space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">{fields.map((field, index) => <label key={field.name} className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-slate-800"><span className="break-words">{fieldLabel(field, index)}<span className="ml-1 text-xs font-normal text-slate-500">（{field.required ? "必填" : "选填"}）</span></span>
        {field.type === "boolean" ? <select value={values[field.name] ?? ""} onChange={(event) => update(field.name, event.target.value)} className="h-11 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select> : field.type === "object" || field.type === "array" ? <textarea value={values[field.name] ?? ""} maxLength={4000} onChange={(event) => update(field.name, event.target.value)} rows={3} placeholder={field.type === "object" ? "用 { } 包裹结构化内容" : "用 [ ] 包裹列表内容"} className="min-w-0 resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" /> : <input type="text" inputMode={field.type === "number" ? "decimal" : undefined} value={values[field.name] ?? ""} maxLength={4000} onChange={(event) => update(field.name, event.target.value)} placeholder={field.type === "number" ? "填写数字" : "填写内容"} className="h-11 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />}
      </label>)}</div>
      <div className="flex flex-wrap items-center gap-2"><button type="submit" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"><ClipboardCheck className="size-4" />检查填写格式</button><button type="button" onClick={() => { setValues({}); setCheck(null); }} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Eraser className="size-4" />清空试填</button></div>
      {check ? <p role="status" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-6 ${check.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{check.ok ? <CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0" /> : <LockKeyhole aria-hidden="true" className="mt-1 size-4 shrink-0" />}{check.ok ? `已核对 ${check.checkedFields} 项填写格式；没有提交或运行任务。` : check.error}</p> : null}
    </form> : <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">这个版本没有结构化输入字段，无法据此预览网页填写表单。请先核对助手的输入契约。</p>}
    <p className="mt-4 text-xs leading-5 text-slate-500">试填内容只保留在当前页面内；请勿输入真实密钥或敏感资料。正式网页工具的访问、运行与结果展示仍需服务端接口。</p>
  </section>;
}
