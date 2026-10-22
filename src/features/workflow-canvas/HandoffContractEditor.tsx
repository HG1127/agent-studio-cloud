"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HandoffContract } from "@/contracts/workflow";

type Fields = HandoffContract["inputSchema"];
const types: Record<Fields[number]["type"], string> = { string: "文字", number: "数字", boolean: "是或否", object: "对象", array: "列表", any: "不限格式" };
const controlClass = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-normal text-slate-900";
const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

function LineListInput({ label, items, rows, onChange }: { label: string; items: string[]; rows: number; onChange: (items: string[]) => void }) {
  const source = items.join("\n");
  const [editing, setEditing] = useState({ source, text: source });
  return <textarea aria-label={label} rows={rows} placeholder="每行一项" value={editing.source === source ? editing.text : source}
    onFocus={() => setEditing({ source, text: source })} onBlur={() => setEditing({ source, text: source })}
    onChange={(event) => {
      const text = event.target.value;
      const next = lines(text);
      setEditing({ source: next.join("\n"), text });
      onChange(next);
    }} className={controlClass} />;
}

function FieldList({ title, prefix, fields, onChange }: { title: string; prefix: string; fields: Fields; onChange: (fields: Fields) => void }) {
  function addField() {
    let index = 1;
    while (fields.some((field) => field.name === `field_${index}`)) index += 1;
    onChange([...fields, { name: `field_${index}`, label: "新增字段", type: "string", required: true }]);
  }
  return <details className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
    <summary className="cursor-pointer text-xs font-semibold text-slate-800">{title}约定 · {fields.length} 项</summary>
    <div className="mt-3 space-y-3">
      {fields.length === 0 ? <p role="status" className="text-xs leading-5 text-amber-800">还没有{title}。完整交接需要明确传入内容和返回结果。</p> : null}
      {fields.map((field, index) => {
        const label = `${prefix}${title} ${index + 1}`;
        const update = (patch: Partial<Fields[number]>) => onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
        return <fieldset key={index} className="min-w-0 space-y-2 rounded-lg bg-slate-50 p-2.5">
          <legend className="px-1 text-xs font-semibold text-slate-700">第 {index + 1} 项</legend>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-600">字段位置<input aria-label={`${label} 位置`} value={field.name} maxLength={200} onChange={(event) => update({ name: event.target.value })} className={controlClass} /></label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-600">显示名称<input aria-label={`${label} 名称`} value={field.label ?? ""} onChange={(event) => update({ label: event.target.value })} className={controlClass} /></label>
          <div className="flex min-w-0 items-center gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-slate-600">格式<select aria-label={`${label} 格式`} value={field.type} onChange={(event) => update({ type: event.target.value as Fields[number]["type"] })} className={controlClass}>{Object.entries(types).map(([type, name]) => <option key={type} value={type}>{name}</option>)}</select></label>
            <label className="mt-5 flex shrink-0 items-center gap-1 text-xs text-slate-700"><input aria-label={`${label} 必须提供`} type="checkbox" checked={field.required} onChange={(event) => update({ required: event.target.checked })} />必须提供</label>
          </div>
          <Button type="button" variant="ghost" size="sm" className="w-full text-red-700" aria-label={`移除${label}`} onClick={() => onChange(fields.filter((_, itemIndex) => itemIndex !== index))}>移除此字段</Button>
        </fieldset>;
      })}
      <Button type="button" variant="secondary" size="sm" onClick={addField} aria-label={`添加${prefix}${title}`}>添加{title}</Button>
    </div>
  </details>;
}

export function HandoffContractEditor({ value, onChange, label = "交接约定" }: { value?: HandoffContract; onChange: (value: HandoffContract) => void; label?: string }) {
  const contract = value ?? { deliverables: [], mustNotInclude: [], inputSchema: [], outputSchema: [] };
  const prefix = label === "交接约定" ? "" : `${label} `;
  const [shareOpen, setShareOpen] = useState(false);
  const parsed = HandoffContract.safeParse(contract);
  const update = (patch: Partial<HandoffContract>) => onChange({ ...contract, ...patch });
  const setMode = (mode: "none" | "team") => update({ memoryPolicy: { ...contract.memoryPolicy, mode, shared: contract.memoryPolicy?.shared ?? [], private: contract.memoryPolicy?.private ?? [] } });
  return <section aria-label={label} className="min-w-0 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3">
    <div><h3 className="text-sm font-semibold text-slate-900">交接约定</h3><p className="mt-1 text-xs leading-5 text-slate-600">修改进入当前画布草稿，可撤销；保存后仍需设计检查和重新发布。不会改变正在使用的正式版本。</p></div>
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-700">必须交付<LineListInput label={`${prefix}必须交付`} rows={3} items={contract.deliverables} onChange={(deliverables) => update({ deliverables })} /></label>
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-700">禁止传递<LineListInput label={`${prefix}禁止传递`} rows={3} items={contract.mustNotInclude} onChange={(mustNotInclude) => update({ mustNotInclude })} /></label>
    <p className="text-xs leading-5 text-slate-500">禁止内容按字段名称及已支持的敏感文本规则移除，不保证识别所有隐私表述。交付清单用于交接说明，结果仍要按返回字段检查。</p>
    <FieldList title="传入字段" prefix={prefix} fields={contract.inputSchema} onChange={(inputSchema) => update({ inputSchema })} />
    <FieldList title="返回字段" prefix={prefix} fields={contract.outputSchema} onChange={(outputSchema) => update({ outputSchema })} />
    <p className="text-xs leading-5 text-slate-500">字段位置需符合接收助手的固定版本约定。这些设置用于校验，不会自动补出缺失数据或建立输入映射。</p>
    {!parsed.success ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs leading-5 text-red-700">交接字段位置不能为空、不能超过 200 字，也不能使用保留名称。请核对后再保存。</p> : null}
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-700">经验传递范围<select aria-label={`${prefix}经验传递范围`} value={contract.memoryPolicy?.mode ?? ""} onChange={(event) => {
      if (event.target.value === "team") setShareOpen(true);
      else if (event.target.value === "none") setMode("none");
    }} className={controlClass}>
      <option value="" disabled>请选择经验传递范围</option><option value="none">不传递上游经验步骤结果</option><option value="team">允许传递上游经验步骤结果</option>
      {contract.memoryPolicy?.mode === "self" ? <option value="self">不传递上游经验（保留原设置）</option> : null}
    </select></label>
    {!contract.memoryPolicy ? <p role="status" className="text-xs leading-5 text-amber-800">还没有设置经验传递范围，发布检查会核对这项边界。</p> : null}
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-700">不得传递的字段名称<LineListInput label={`${prefix}不得传递的字段名称`} rows={2} items={contract.memoryPolicy?.private ?? []} onChange={(privateFields) => update({ memoryPolicy: { ...contract.memoryPolicy, mode: contract.memoryPolicy?.mode ?? "none", shared: contract.memoryPolicy?.shared ?? [], private: privateFields } })} /></label>
    {contract.memoryPolicy?.shared.length ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900">原约定中的共享名称：{contract.memoryPolicy.shared.join("、")}。当前执行不会按这些名称单独筛选经验，不能把它们当作白名单。</p> : null}
    <ConfirmDialog open={shareOpen} onOpenChange={setShareOpen} title="允许传递上游经验步骤结果？" tone="warning" confirmLabel="确认允许传递" description="本次流程已有的经验步骤结果将纳入交接上下文，仍会经过禁止字段和敏感内容处理。当前不会按共享名称单独筛选；这只修改草稿，不新增助手权限。" onConfirm={() => { setShareOpen(false); setMode("team"); }} />
  </section>;
}
