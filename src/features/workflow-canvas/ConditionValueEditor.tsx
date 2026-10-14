"use client";

import { useState } from "react";

interface ConditionValueEditorProps {
  label: string;
  operator: string;
  value: unknown;
  onChange: (value: unknown) => void;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "unset";
  return ["string", "number", "boolean"].includes(typeof value) ? typeof value : "structured";
}

function finiteNumber(text: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim())) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function ConditionValueEditor({ label, operator, value, onChange }: ConditionValueEditorProps) {
  const type = valueType(value);
  const [draft, setDraft] = useState<{ label: string; source: unknown; text: string } | null>(null);
  const [rejected, setRejected] = useState(false);
  const activeDraft = draft?.label === label && Object.is(draft.source, value) ? draft : null;
  const numberText = activeDraft?.text ?? String(value ?? "");
  const invalidNumber = type === "number" && finiteNumber(numberText) === null;
  const inputClass = "w-full min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs";

  if (operator === "truthy" || operator === "exists") return <p className="text-xs leading-5 text-slate-500">此判断不使用比较值，原有比较值会保留。</p>;

  return <div className="grid min-w-0 gap-2">
    <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-600">值的类型
      <select aria-label={`${label}类型`} value={type} className={inputClass} onChange={(event) => {
        setDraft(null);
        setRejected(false);
        const nextType = event.target.value;
        if (nextType === "string") onChange(typeof value === "string" ? value : value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
        if (nextType === "number") onChange(typeof value === "number" ? value : typeof value === "string" ? finiteNumber(value) ?? 0 : 0);
        if (nextType === "boolean") onChange(typeof value === "boolean" ? value : false);
        if (nextType === "null") onChange(null);
      }}>
        <option value="string">文字</option>
        <option value="number">数字</option>
        <option value="boolean">是 / 否</option>
        <option value="null">空值</option>
        {type === "unset" ? <option value="unset">未设置（保留原值）</option> : null}
        {type === "structured" ? <option value="structured">对象或列表（保留原值）</option> : null}
      </select>
    </label>
    {type === "string" ? <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-600">比较值
      <input aria-label={label} value={String(value)} className={inputClass} onChange={(event) => onChange(event.target.value)} />
    </label> : type === "number" ? <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-600">比较值
      <input aria-label={label} inputMode="decimal" value={numberText} aria-invalid={invalidNumber || rejected} className={inputClass}
        onChange={(event) => {
          const text = event.target.value;
          const parsed = finiteNumber(text);
          setRejected(false);
          setDraft({ label, source: parsed ?? value, text });
          if (parsed !== null) onChange(parsed);
        }}
        onBlur={() => {
          if (invalidNumber) {
            setDraft(null);
            setRejected(true);
          }
        }} />
    </label> : type === "boolean" ? <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-600">比较值
      <select aria-label={label} value={String(value)} className={inputClass} onChange={(event) => onChange(event.target.value === "true")}>
        <option value="true">是</option><option value="false">否</option>
      </select>
    </label> : type === "structured" ? <details className="min-w-0 text-xs text-slate-600">
      <summary className="cursor-pointer">查看原比较值（开发者数据）</summary>
      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded border bg-slate-50 p-2">{JSON.stringify(value, null, 2)}</pre>
      <p className="mt-1 leading-5">原数据未改动；更改类型会替换它，可通过画布撤销恢复。</p>
    </details> : <p className="text-xs text-slate-500">{type === "null" ? "比较值为空值，不是空文字。" : "没有设置比较值；请选择类型后填写。"}</p>}
    {invalidNumber || (type === "number" && rejected) ? <p role="alert" className="text-xs leading-5 text-red-700">未采用无效数字，草稿仍使用上一次有效数字。请输入完整的有限数字。</p> : null}
    {type === "string" ? <p className="text-xs leading-5 text-slate-500">按文字保存，不会自动转成数字或“是 / 否”。</p> : null}
  </div>;
}
