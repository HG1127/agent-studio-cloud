"use client";

import { useRef, useState } from "react";
import { InputSourcePath } from "@/contracts/input-mapping";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { OutputField } from "./workflow-output-editing";

export function OutputSourcePathEditor({ field, index, revisionKey, onChange }: {
  field: OutputField;
  index: number;
  revisionKey: string;
  onChange: (path: string[]) => void;
}) {
  const path = field.sourcePath ?? [];
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const mode = useRef<HTMLSelectElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [confirmation, setConfirmation] = useState<{ snapshot: string; position: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canAdd = InputSourcePath.safeParse([...path, "新字段"]).success;
  const validation = InputSourcePath.safeParse(path);
  const issue = validation.success ? null : validation.error.issues.some((item) => item.code === "custom")
    ? "来源层级不能使用保留名称。原值已保留，请明确修改。"
    : "每层需填写实际字段名，并符合来源层级长度与数量限制；不会猜测或自动修复原值。";

  function change(next: string[]) {
    setError(null);
    onChange(next);
  }
  function confirm() {
    if (!confirmation) return;
    if (confirmation.snapshot !== revisionKey) {
      setError("交付定义或来源已发生变化，请重新核对后再调整取值范围。");
      setConfirmation(null);
      return;
    }
    const next = confirmation.position === null ? [] : path.filter((_, position) => position !== confirmation.position);
    returnFocus.current = mode.current;
    change(next);
    setConfirmation(null);
  }

  return <fieldset className="mt-3 min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
    <legend className="px-1 text-xs font-medium text-slate-700">来源取值</legend>
    <label className="block text-xs text-slate-600">取值方式<select ref={mode} aria-label={`交付字段 ${index + 1} 取值方式`} value={path.length ? "field" : "whole"}
      onChange={(event) => {
        if (event.target.value === "field" && !path.length) {
          change([""]);
          requestAnimationFrame(() => inputs.current[0]?.focus());
        } else if (event.target.value === "whole" && path.length) {
          returnFocus.current = event.currentTarget;
          setConfirmation({ snapshot: revisionKey, position: null });
        }
      }} className="mt-1 block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
      <option value="whole">整个步骤结果</option><option value="field">指定来源子字段</option>
    </select></label>
    <p className="mt-2 text-[11px] leading-5 text-slate-600">来源层级从外到内逐层读取真实结果；每格只填一层的完整字段名，字段名中的点不会拆开。列表位置从 0 开始。不会依据名称或模型说明猜测结果结构。</p>
    {path.length ? <>
      <ol className="mt-2 space-y-2">{path.map((segment, position) => <li key={position} className="flex min-w-0 items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-slate-600">第 {position + 1} 层<input ref={(element) => { inputs.current[position] = element; }} aria-label={`交付字段 ${index + 1} 来源层级 ${position + 1}`} value={segment} maxLength={InputSourcePath.element.maxLength ?? undefined}
          onChange={(event) => change(path.map((value, current) => current === position ? event.target.value : value))}
          className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" /></label>
        <button type="button" aria-label={`删除交付字段 ${index + 1} 来源层级 ${position + 1}`} onClick={(event) => {
          returnFocus.current = event.currentTarget;
          setError(null);
          setConfirmation({ snapshot: revisionKey, position });
        }} className="h-9 shrink-0 rounded-md border border-slate-200 bg-white px-2 text-xs text-red-700">删除层级</button>
      </li>)}</ol>
      <button type="button" disabled={!canAdd} onClick={() => {
        change([...path, ""]);
        requestAnimationFrame(() => inputs.current[path.length]?.focus());
      }} className="mt-2 h-9 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 disabled:opacity-40">添加来源层级</button>
      {!canAdd ? <p className="mt-1 text-[11px] leading-5 text-amber-800">无法再添加层级：请先修正当前定义，或核对是否已达到来源层级上限。</p> : null}
    </> : <p className="mt-2 text-xs text-slate-600">不提取子字段，保留整个来源步骤结果。</p>}
    {issue ? <p role="alert" className="mt-2 text-xs leading-5 text-amber-800">{issue}</p> : null}
    {error ? <p role="alert" className="mt-2 text-xs leading-5 text-red-700">{error}</p> : null}
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }} title={confirmation?.position === null ? "改为整个步骤结果？" : "删除这个来源层级？"}
      description={confirmation?.position === null || path.length === 1
        ? "现有来源子字段选择将清除，改为保留整个步骤结果。其他交付定义和历史运行不受影响；修改只留在当前草稿，可撤销。"
        : "只删除选中的层级，其余字段名保留，但读取层级会改变。请重新核对参考数据；修改只留在当前草稿，可撤销。"}
      confirmLabel="确认调整取值" onConfirm={confirm} tone="warning" returnFocusRef={returnFocus} />
  </fieldset>;
}
