"use client";

import { useRef, useState } from "react";
import { MAX_WORKFLOW_OUTPUT_FIELDS, type WorkflowDraft, type WorkflowNode } from "@/contracts/workflow";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { requestWorkflowNodeFocus } from "@/lib/workflow-node-focus";
import { moveOutputDefinition, newOutputDefinition, outputDefinitionIssue, outputSourceOptions, sameOutputSelection, type OutputField } from "./workflow-output-editing";
import { OutputSourcePathEditor } from "./OutputSourcePathEditor";
import { WorkflowOutputPreview } from "./WorkflowOutputPreview";

export function WorkflowOutputEditor({ nodes, fields, workflow, agentId, onChange }: {
  nodes: Record<string, WorkflowNode>;
  fields: OutputField[];
  workflow?: WorkflowDraft;
  agentId?: string;
  onChange: (fields: OutputField[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<"all" | "required" | "optional" | "issue">("all");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ index: number; snapshot: string; label: string } | null>(null);
  const labels = useRef<Array<HTMLInputElement | null>>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement>(null);
  const candidates = outputSourceOptions(nodes);
  const referenced = candidates.filter((option) => fields.some((field) => field.sourceNodeId === option.node.id));
  const rows = fields.map((field, index) => ({ field, index, issue: outputDefinitionIssue(field, fields, nodes) }));
  const matching = rows.filter(({ field, issue }) => (range === "all" || (range === "required" ? field.required : range === "optional" ? !field.required : !!issue))
    && (!query.trim() || `${field.label ?? ""} ${field.path} ${candidates.find((option) => option.node.id === field.sourceNodeId)?.label ?? ""} ${(field.sourcePath ?? []).join(" ")}`.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN"))));
  const visible = expanded ? matching : matching.slice(0, 8);
  const hasFilters = Boolean(query.trim()) || range !== "all";

  function update(index: number, patch: Partial<OutputField>) {
    setError(null);
    onChange(fields.map((field, position) => position === index ? { ...field, ...patch } : field));
  }
  function resetFilters() { setQuery(""); setRange("all"); setExpanded(false); }
  function add() {
    if (fields.length >= MAX_WORKFLOW_OUTPUT_FIELDS) return;
    const field = newOutputDefinition(fields, nodes);
    if (!field) { setError("无法添加不冲突的字段位置，请先核对现有来源与字段位置。"); return; }
    setError(null); setQuery(""); setRange("all"); setExpanded(true);
    onChange([...fields, field]);
    requestAnimationFrame(() => labels.current[fields.length]?.focus());
  }
  function move(index: number, delta: -1 | 1) {
    const next = moveOutputDefinition(fields, index, delta);
    if (next === fields) return;
    setError(null); setExpanded(true);
    onChange(next);
    requestAnimationFrame(() => labels.current[index + delta]?.focus());
  }
  function remove() {
    if (!confirmation) return;
    if (JSON.stringify({ fields, nodes }) !== confirmation.snapshot) {
      setError("交付定义或来源已发生变化，请重新核对后再删除。");
      setConfirmation(null);
      return;
    }
    setError(null);
    returnFocus.current = addButton.current;
    onChange(fields.filter((_, index) => index !== confirmation.index));
    setConfirmation(null);
  }

  return <details className="rounded-xl border border-slate-200 bg-white p-4">
    <summary className="cursor-pointer text-sm font-semibold text-slate-950">最终交付字段（{fields.length}）</summary>
    <section aria-label="最终交付定义工作台" className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-slate-600">选择步骤结果作为最终交付。修改只留在草稿，保存并发布后才影响新版本；换序不改变流程执行顺序。</p>
      <p className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-2.5 text-xs leading-5 text-indigo-950">结果字段位置决定交付内容放在哪里；来源取值决定保留整个步骤结果，还是逐层读取其中的子字段。两者分别设置，不会按交付位置猜测来源。组内来源可定位到所属画布步骤，再核对组内设置。</p>
      <dl aria-label="交付定义概览" className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-indigo-50 p-2.5"><dt className="text-indigo-700">必须产出</dt><dd className="mt-1 text-lg font-semibold text-indigo-900">{fields.filter((field) => field.required).length}</dd></div>
        <div className="rounded-lg bg-slate-50 p-2.5"><dt className="text-slate-600">可选交付</dt><dd className="mt-1 text-lg font-semibold text-slate-900">{fields.filter((field) => !field.required).length}</dd></div>
        <div className="rounded-lg bg-amber-50 p-2.5"><dt className="text-amber-800">需核对字段</dt><dd className="mt-1 text-lg font-semibold text-amber-900">{rows.filter((row) => row.issue).length}</dd></div>
      </dl>
      {fields.length ? <>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 text-xs font-medium text-slate-700">查找交付定义<input aria-label="查找交付定义" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setExpanded(false); }} placeholder="按名称、位置或来源查找" className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm" /></label>
          <label className="text-xs font-medium text-slate-700">交付范围<select aria-label="交付定义范围" value={range} onChange={(event) => { setRange(event.target.value as typeof range); setExpanded(false); }} className="mt-1 block h-9 max-w-full rounded-lg border border-slate-300 px-2 text-sm"><option value="all">全部定义</option><option value="required">必须产出</option><option value="optional">可选交付</option><option value="issue">需核对字段</option></select></label>
          {hasFilters ? <button type="button" onClick={resetFilters} className="h-9 rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-700">清除交付筛选</button> : null}
        </div>
        <p role="status" className="text-xs text-slate-500">匹配 {matching.length} 项，显示 {visible.length} 项。顺序操作调整完整定义，不仅是筛选结果。</p>
        {visible.length ? <ol aria-label="交付定义列表" className="space-y-3">{visible.map(({ field, index, issue }) => {
          const source = candidates.find((option) => option.node.id === field.sourceNodeId);
          const sameSourceCount = fields.filter((item) => sameOutputSelection(field, item)).length;
          return <li key={index} className="min-w-0 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 break-words text-sm font-semibold text-slate-900">{field.label?.trim() || `交付定义 ${index + 1}`}</h3><span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{field.required ? "必须产出" : "可选交付"}</span></div>
            <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-600">来源步骤<select aria-label={`交付字段 ${index + 1} 来源`} value={field.sourceNodeId ?? ""}
                onChange={(event) => { const selected = candidates.find((option) => option.node.id === event.target.value); if (selected) update(index, { sourceNodeId: selected.node.id, label: field.label || selected.node.title }); }}
                className="w-full min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {!source ? <option value={field.sourceNodeId ?? ""}>{field.sourceNodeId ? "原来源已不可用，请重新选择" : "原定义未明确来源，请选择"}</option> : null}
                {candidates.map((option) => <option key={option.node.id} value={option.node.id}>{option.label}</option>)}
              </select></label>
              <label className="min-w-0 text-xs text-slate-600">结果字段位置<input aria-label={`交付字段 ${index + 1} 位置`} value={field.path} placeholder="交付.方案" maxLength={200}
                onChange={(event) => update(index, { path: event.target.value })} className="mt-1 w-full min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm" /><span className="mt-1 block text-[11px] leading-4">可用中文、字母、数字、下划线或连字符；用点分层，每层不能以数字或连字符开头。</span></label>
              <label className="min-w-0 text-xs text-slate-600">显示名称<input ref={(element) => { labels.current[index] = element; }} aria-label={`交付字段 ${index + 1} 显示名称`} value={field.label ?? ""} maxLength={200}
                onChange={(event) => update(index, { label: event.target.value })} className="mt-1 w-full min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm" /></label>
              <label className="flex items-center gap-2 self-end py-1.5 text-xs text-slate-600"><input aria-label={`交付字段 ${index + 1} 必需`} type="checkbox" checked={field.required} onChange={(event) => update(index, { required: event.target.checked })} />必须有产出</label>
            </div>
            <OutputSourcePathEditor field={field} index={index} revisionKey={JSON.stringify({ fields, nodes })} onChange={(sourcePath) => update(index, { sourcePath })} />
            {field.sourcePath?.length ? <p className="mt-2 text-[11px] leading-5 text-slate-500">切换来源会保留这些层级；请重新核对新来源实际保存的数据结构。</p> : null}
            {issue ? <p role="alert" className="mt-2 text-xs leading-5 text-amber-800">{issue}</p> : null}
            {sameSourceCount > 1 ? <p className="mt-2 text-xs leading-5 text-slate-500">{sameSourceCount} 项交付的来源和取值层级完全相同，会保存同一份值；不同子字段可分别设置来源层级。</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {source && agentId ? <button type="button" onClick={() => requestWorkflowNodeFocus({ agentId, nodeId: source.ownerId })} className="min-h-9 rounded-lg border border-indigo-200 px-2 text-xs font-semibold text-indigo-700">定位交付来源步骤</button> : null}
              <button type="button" aria-label={`上移交付字段 ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)} className="min-h-9 rounded-lg border border-slate-200 px-2 text-xs text-slate-700 disabled:opacity-40">上移</button>
              <button type="button" aria-label={`下移交付字段 ${index + 1}`} disabled={index === fields.length - 1} onClick={() => move(index, 1)} className="min-h-9 rounded-lg border border-slate-200 px-2 text-xs text-slate-700 disabled:opacity-40">下移</button>
              <button type="button" aria-label={`删除交付字段 ${index + 1}`} onClick={(event) => { setError(null); returnFocus.current = event.currentTarget; setConfirmation({ index, snapshot: JSON.stringify({ fields, nodes }), label: field.label?.trim() || `交付定义 ${index + 1}` }); }} className="ml-auto min-h-9 rounded-lg px-2 text-xs font-semibold text-red-600 hover:bg-red-50">删除</button>
            </div>
          </li>;
        })}</ol> : <div className="rounded-lg border border-dashed border-slate-300 p-3"><p className="text-xs leading-5 text-slate-600">没有匹配的交付定义，原定义没有删除。</p><button type="button" onClick={resetFilters} className="mt-2 text-xs font-semibold text-indigo-700">查看全部交付定义</button></div>}
        {matching.length > 8 ? <button type="button" onClick={() => setExpanded(!expanded)} className="text-xs font-semibold text-indigo-700">{expanded ? "收起交付定义" : `展开全部 ${matching.length} 项交付定义`}</button> : null}
      </> : <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs leading-5 text-slate-600">尚未定义最终交付字段。没有定义时，现有执行会保留步骤结果清单；不代表业务交付已约定。</p>}
      <p className="text-[11px] leading-5 text-slate-500">必须有产出只检查所选来源是否保存了可用结果，不证明结果的业务正确性。来源可能处于未执行分支；可选来源没有产出时，该字段不会进入本次最终交付。</p>
      {candidates.length === 0 ? <p className="text-xs text-amber-800">当前没有可选择的业务步骤，先在画布中添加业务步骤。</p> : null}
      {fields.length >= MAX_WORKFLOW_OUTPUT_FIELDS ? <p className="text-xs text-amber-700">最终交付字段已达到 {MAX_WORKFLOW_OUTPUT_FIELDS} 项上限。</p> : null}
      {error ? <p role="alert" className="text-xs leading-5 text-red-700">{error}</p> : null}
      <button ref={addButton} type="button" disabled={candidates.length === 0 || fields.length >= MAX_WORKFLOW_OUTPUT_FIELDS} onClick={add} className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:border-indigo-400 disabled:opacity-40">添加交付字段</button>
      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-indigo-800">核对来源参考数据（不执行）</summary>
        <div className="mt-3">{workflow ? <WorkflowOutputPreview workflow={workflow} sources={referenced.map((option) => option.node)} sourceLabels={Object.fromEntries(referenced.map((option) => [option.node.id, option.label]))} />
          : <p className="text-xs leading-5 text-slate-600">完整流程草稿暂不可读，无法试算；不会用示例流程代替真实定义。</p>}</div>
      </details>
    </section>
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }} title="删除这项交付定义？"
      description={`“${confirmation?.label ?? "这项交付"}”将从当前草稿中移除，不会删除来源步骤或改写其他交付。删除最后一项后，运行会保留步骤结果清单，不代表没有执行产出；已发布版本与历史运行不受当前草稿修改影响。`}
      confirmLabel="删除交付定义" onConfirm={remove} returnFocusRef={returnFocus} />
  </details>;
}
