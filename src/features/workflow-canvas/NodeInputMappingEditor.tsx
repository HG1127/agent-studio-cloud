"use client";

import { useRef, useState } from "react";
import { MAX_INPUT_BINDINGS } from "@/contracts/input-mapping";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NodeInputMappingPreview } from "./NodeInputMappingPreview";
import type { ContractEditorMemory } from "./use-node-contract-edits";
import {
  emptyMappingRow, mappingContextKey, mappingEditFrom, mappingEligibility, mappingSources, validateMappingEdit,
  type MappingEdit, type MappingRow,
} from "./node-input-mapping-editing";

type Session = { base: string; baseEpoch: number; edit: MappingEdit; awaitingNode?: string; message: string | null; error: string | null };
type Confirmation = { kind: "delete" | "clear" | "include" | "reload" | "apply"; index?: number; nodeId: string; context: string; epoch: number; edit: string; revision: number };
function PathEditor({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  return <fieldset className="space-y-2"><legend className="text-xs font-medium text-slate-700">{label}</legend>
    {!value.length ? <p className="text-xs text-slate-500">{label === "来源路径" ? "未指定层级，读取整个来源。" : "目标至少需要一层字段名。"}</p> : null}
    {value.map((segment, index) => <div key={index} className="flex items-start gap-2"><label className="min-w-0 flex-1 text-xs text-slate-600">{label}第 {index + 1} 层<textarea rows={1} value={segment} onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm" /></label><button type="button" aria-label={"移除" + label + "第 " + (index + 1) + " 层"} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} className="mt-5 text-xs text-slate-600">移除层级</button></div>)}
    <button type="button" onClick={() => onChange([...value, ""])} className="text-xs font-semibold text-indigo-700">为{label}添加一层</button>
  </fieldset>;
}
export function NodeInputMappingEditor({ node, workflow, onNodeChange, memory, previewVisible = true }: {
  node: WorkflowNode; workflow: WorkflowDraft; onNodeChange: (node: WorkflowNode) => void | boolean;
  memory?: ContractEditorMemory<MappingEdit>; previewVisible?: boolean;
}) {
  const context = mappingContextKey(node, workflow);
  const [contextVersion, setContextVersion] = useState({ key: context, epoch: 0 });
  const localEpoch = contextVersion.key === context ? contextVersion.epoch : contextVersion.epoch + 1;
  const epoch = memory?.epoch ?? localEpoch;
  if (contextVersion.key !== context) setContextVersion({ key: context, epoch: localEpoch });
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const editingRevision = useRef(0);
  const [previewRevision, setPreviewRevision] = useState(0);
  const localSession = Object.hasOwn(sessions, node.id) ? sessions[node.id] : { base: context, baseEpoch: epoch, edit: mappingEditFrom(node), message: null, error: null };
  const session = memory ? { ...localSession, base: context, baseEpoch: memory.entry?.epoch ?? epoch, edit: memory.entry?.value ?? mappingEditFrom(node) } : localSession;
  if (!Object.hasOwn(sessions, node.id)) setSessions({ ...sessions, [node.id]: session });
  if (session.awaitingNode === JSON.stringify(node)) setSessions({ ...sessions, [node.id]: { ...session, base: context, baseEpoch: epoch, awaitingNode: undefined } });
  const eligibility = mappingEligibility(node);
  const sources = mappingSources(workflow);
  const stale = session.base !== context || session.baseEpoch !== epoch;
  const validation = validateMappingEdit(node, workflow, session.edit);
  function update(edit: MappingEdit) {
    editingRevision.current += 1;
    setPreviewRevision((value) => value + 1);
    memory?.change(edit);
    setSessions({ ...sessions, [node.id]: { ...session, edit, error: null, message: null } });
  }
  function updateRow(index: number, changes: Partial<MappingRow>) {
    update({ ...session.edit, rows: session.edit.rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row) });
  }
  function ask(kind: Confirmation["kind"], index?: number) {
    setConfirmation({ kind, index, nodeId: node.id, context, epoch, edit: JSON.stringify(session.edit), revision: memory?.entry?.revision ?? editingRevision.current });
  }
  function confirm() {
    const requested = confirmation;
    setConfirmation(null);
    if (!requested || requested.nodeId !== node.id || requested.context !== context || requested.epoch !== epoch || requested.edit !== JSON.stringify(session.edit)
      || requested.revision !== (memory?.entry?.revision ?? editingRevision.current)
      || (requested.kind !== "reload" && stale)) {
      setSessions({ ...sessions, [node.id]: { ...session, error: "草稿或本页编辑已经变化，原确认失效。请重新核对后再操作。" } }); return;
    }
    if (requested.kind === "reload") {
      editingRevision.current += 1;
      memory?.discard();
      setSessions({ ...sessions, [node.id]: { base: context, baseEpoch: epoch, edit: mappingEditFrom(node), error: null, message: "已重新读取当前画布草稿。" } }); return;
    }
    if (!eligibility.editable) return;
    if (requested.kind === "apply") {
      const result = validateMappingEdit(node, workflow, session.edit);
      if (!result.ok) { setSessions({ ...sessions, [node.id]: { ...session, error: result.error } }); return; }
      if (onNodeChange(result.node) === false) {
        setSessions({ ...sessions, [node.id]: { ...session, error: "完整画布草稿未接受这次修改，原值与本页编辑均保留。请核对下方说明后再应用。", message: null } }); return;
      }
      setSessions({ ...sessions, [node.id]: { ...session, awaitingNode: JSON.stringify(result.node), error: null, message: "已交给画布草稿，尚未保存到服务端。请通过画布保存；也可通过画布撤销。" } });
      return;
    }
    if (requested.kind === "delete") update({ ...session.edit, rows: session.edit.rows.filter((_, index) => index !== requested.index) });
    if (requested.kind === "clear") update({ ...session.edit, configured: false, includeUpstreamOutputs: false });
    if (requested.kind === "include" && eligibility.canIncludeOutputs) update({ ...session.edit, includeUpstreamOutputs: true });
  }
  function apply() {
    if (stale || !eligibility.editable) { setSessions({ ...sessions, [node.id]: { ...session, error: "画布草稿已经变化或当前步骤不能编辑映射，请重新核对；原值保持不变。" } }); return; }
    const result = validateMappingEdit(node, workflow, session.edit);
    if (!result.ok) { setSessions({ ...sessions, [node.id]: { ...session, error: result.error } }); return; }
    ask("apply");
  }
  const titles = { delete: "确认删除这条映射？", clear: "确认清除输入映射？", include: "确认额外携带全部上游成果？", reload: "确认重新读取当前草稿？", apply: "确认应用这组输入设置？" };
  const descriptions = {
    delete: "本页将移除这条字段来源，仍需明确应用到画布草稿才会生效。请先核对目标字段与后续需要。",
    clear: "应用后将取消字段映射，恢复执行器原有输入方式，可能扩大传入内容。此操作尚未保存。",
    include: "应用后除已映射字段外，还会额外携带运行时可提供的全部上游成果。请确认确有需要；这不是安全校验。",
    reload: "会舍弃此步骤在本编辑器内尚未应用的改动，重新读取画布当前值；其他步骤的本页编辑仍保留。",
    apply: "将当前已校验的输入设置交给画布草稿。取消映射、删减字段、改为整个来源或携带全部成果都可能改变传入范围，请明确核对；此处不会保存或执行。",
  };
  return <section aria-label="步骤输入字段映射" className="space-y-3 border-t border-slate-200 pt-4">
    <h3 className="text-sm font-semibold text-slate-900">步骤输入字段映射</h3>
    <p className="text-xs leading-5 text-slate-600">按逐层名称明确选择输入来源。名称中的点保留原样，不拆成多层；数字零、否值和空值不会按空白舍弃。</p>
    {!eligibility.editable ? <><p role="status" className="text-xs leading-5 text-amber-900">当前完整步骤配置不支持编辑输入映射。若已有映射则只读保留，不自动移除；请先核对步骤类型及配置。</p>{node.inputMapping ? <>
      <p className="text-xs text-slate-600">原映射保留 {node.inputMapping.fields.length} 条，{node.inputMapping.includeUpstreamOutputs ? "原配置要求额外携带上游成果。" : "原配置不额外携带上游成果。"}</p>
      <ol aria-label="原输入映射只读内容" className="space-y-2 text-xs leading-5 text-slate-600">{node.inputMapping.fields.map((field, index) => {
        const source = field.source;
        return <li key={index} className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2">
          <p>目标逐层名称：{field.target.map((segment) => "「" + segment + "」").join(" → ")}</p>
          <p>{source.kind === "literal" ? "固定值：" + JSON.stringify(source.value) : (source.kind === "input" ? "运行输入" : "步骤成果：" + (sources.options.find((item) => item.id === source.nodeId)?.title ?? "原来源目前无法核对")) + "；" + (source.path.length ? "来源逐层名称：" + source.path.map((segment) => "「" + segment + "」").join(" → ") : "读取整个来源")}</p>
          <p>{field.required ? "来源缺失且没有回退时阻止继续。" : "来源缺失且没有回退时允许省略。"}{field.fallback !== undefined ? "明确回退值：" + JSON.stringify(field.fallback) : "未配置回退值。"}</p>
        </li>;
      })}</ol>
    </> : null}</> : <>
      {stale ? <p role="alert" className="text-xs leading-5 text-amber-900">画布草稿或来源定义已变化，本页未应用内容仍保留，暂不能应用或试算。请明确重新读取后再编辑。</p> : null}
      {sources.incomplete ? <p className="text-xs leading-5 text-amber-900">部分组内来源配置不完整或关联有冲突，未列为可选来源。原映射仍保留，不推测执行顺序。</p> : null}
      <p className="text-xs leading-5 text-slate-500">来源列表只表示定义可定位，不保证它在当前运行路径上已经产生成果。这里不猜测来源字段。</p>
      <fieldset disabled={stale} className="space-y-4">
        {!session.edit.configured ? <div className="space-y-2"><p className="text-xs text-slate-600">当前未配置字段映射，保留执行器原有输入方式。读取本页不会自动新增映射。</p><button type="button" onClick={() => update({ ...session.edit, configured: true })} className="text-xs font-semibold text-indigo-700">开始配置输入映射</button></div> : <>
          <p className="text-xs leading-5 text-amber-900">配置后仅发送已映射字段，未映射的原输入不会自动传入。空映射得到空输入；额外上游成果需单独确认。</p>
          {session.edit.rows.map((row, index) => <fieldset key={index} aria-label={"字段映射 " + (index + 1)} className="space-y-3 rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-700">字段映射 {index + 1}</legend>
            <PathEditor label="目标路径" value={row.target} onChange={(target) => updateRow(index, { target })} />
            <label className="block text-xs text-slate-700">字段来源<select value={row.kind} onChange={(event) => updateRow(index, { kind: event.target.value as MappingRow["kind"] })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2"><option value="input">运行输入</option><option value="output">步骤成果</option><option value="literal">用户固定值</option></select></label>
            {row.kind === "literal" ? <label className="block text-xs text-slate-700">固定值（数据格式）<textarea value={row.literal} onChange={(event) => updateRow(index, { literal: event.target.value })} className="mt-1 min-h-16 w-full rounded-lg border border-slate-200 p-2 font-mono text-xs" /></label> : <>
              {row.kind === "output" ? <label className="block text-xs text-slate-700">来源步骤<select value={row.nodeId} onChange={(event) => updateRow(index, { nodeId: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2"><option value="">明确选择来源步骤</option>{sources.options.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}{row.nodeId && !sources.options.some((source) => source.id === row.nodeId) ? <option value={row.nodeId}>原来源目前无法核对（配置已保留）</option> : null}</select></label> : null}
              <PathEditor label="来源路径" value={row.kind === "input" ? row.inputPath : row.outputPath} onChange={(path) => updateRow(index, row.kind === "input" ? { inputPath: path } : { outputPath: path })} />
            </>}
            <label className="flex items-start gap-2 text-xs leading-5 text-slate-700"><input type="checkbox" checked={row.required} onChange={(event) => updateRow(index, { required: event.target.checked })} />来源缺失且没有回退值时，阻止本步骤继续</label>
            <label className="flex items-start gap-2 text-xs leading-5 text-slate-700"><input type="checkbox" checked={row.hasFallback} onChange={(event) => updateRow(index, { hasFallback: event.target.checked })} />明确配置来源缺失时的回退值</label>
            {row.hasFallback ? <label className="block text-xs text-slate-700">回退值（数据格式）<textarea value={row.fallback} onChange={(event) => updateRow(index, { fallback: event.target.value })} className="mt-1 min-h-16 w-full rounded-lg border border-slate-200 p-2 font-mono text-xs" /></label> : null}
            <button type="button" onClick={() => ask("delete", index)} className="text-xs font-semibold text-red-700">删除这条映射</button>
          </fieldset>)}
          <button type="button" disabled={session.edit.rows.length >= MAX_INPUT_BINDINGS} onClick={() => update({ ...session.edit, rows: [...session.edit.rows, emptyMappingRow()] })} className="text-xs font-semibold text-indigo-700 disabled:opacity-50">添加字段映射</button>
          <p className="text-xs text-slate-500">最多 {MAX_INPUT_BINDINGS} 条。每项固定值或回退值最多六十四千字节，过长路径与保留字段名由共享校验拒绝。</p>
          {eligibility.canIncludeOutputs ? <label className="flex items-start gap-2 text-xs leading-5 text-slate-700"><input type="checkbox" checked={session.edit.includeUpstreamOutputs} onChange={(event) => { if (event.target.checked) ask("include"); else update({ ...session.edit, includeUpstreamOutputs: false }); }} />除映射字段外，额外携带全部上游成果</label> : <p className="text-xs text-slate-600">此步骤只允许逐项映射需要的上游字段，不能额外携带全部成果。</p>}
          <button type="button" onClick={() => ask("clear")} className="text-xs font-semibold text-red-700">清除输入映射</button>
        </>}
      </fieldset>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={stale} onClick={apply} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 disabled:opacity-50">校验并应用到画布草稿</button><button type="button" onClick={() => ask("reload")} className="text-xs font-semibold text-slate-600">重新读取当前草稿</button></div>
      {session.error ? <p role="alert" className="text-xs leading-5 text-amber-900">{session.error}</p> : null}
      {session.message ? <p role="status" className="text-xs leading-5 text-slate-600">{session.message}</p> : null}
      {previewVisible && !stale && validation.ok && validation.mapping ? <NodeInputMappingPreview mapping={validation.mapping} sources={sources.options} scopeKey={context + ":" + epoch + ":" + (memory?.entry?.revision ?? previewRevision)} /> : null}
    </>}
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }} title={confirmation ? titles[confirmation.kind] : "确认修改"} description={confirmation ? descriptions[confirmation.kind] : ""} confirmLabel="明确确认本次修改" onConfirm={confirm} tone={confirmation?.kind === "include" ? "warning" : "danger"} />
  </section>;
}
