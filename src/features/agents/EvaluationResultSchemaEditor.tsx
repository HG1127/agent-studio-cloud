"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MAX_EVALUATION_RESULT_SCHEMA_BYTES } from "@/contracts/evaluation";
import { resultSchemaSource, type ResultSchemaChange, type ResultSchemaSession, type ResultSchemaSource } from "./evaluation-result-schema-draft";

function SourceReview({ source, creating = false }: { source: ResultSchemaSource; creating?: boolean }) {
  return <div className="min-w-0 text-xs leading-5 text-slate-600">
    <p>{source.kind === "object" ? "已保存结果结构规则，验收会检查最终结果的字段结构。" : source.kind === "none" ? "已明确未设置结果结构规则；已有字段检查仍保留。" : source.kind === "unknown" ? "规则内容暂时无法解释，不能按没有规则处理；未修改时保留原值。" : creating ? "新样例尚未设置结果结构规则，不会自动生成示例。" : "未读取到结果结构规则字段，不能当成已明确清除；未修改时保留现有值。"}</p>
    {source.kind === "object" ? <details className="mt-2 min-w-0">
      <summary className="cursor-pointer font-medium text-slate-600">查看已保存规则（开发者数据）</summary>
      <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(source.value, null, 2)}</pre>
    </details> : null}
  </div>;
}

export function EvaluationResultSchemaSummary({ value, supplied }: { value: unknown; supplied: boolean }) {
  return <section aria-label="已保存的结果结构规则" className="mt-3 min-w-0 border-t border-slate-100 pt-3">
    <SourceReview source={resultSchemaSource(value, supplied)} />
  </section>;
}

export function EvaluationResultSchemaEditor({ session, locked, creating, onChange }: {
  session: ResultSchemaSession;
  locked: boolean;
  creating: boolean;
  onChange: (request: ResultSchemaChange) => boolean;
}) {
  const [confirmation, setConfirmation] = useState<{ kind: "clear" | "cancel"; generation: number; revision: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focus = useRef<HTMLButtonElement>(null);
  const text = session.edit.kind === "clear" ? null : session.edit.text;
  const editing = text !== null;
  function request(operation: ResultSchemaChange["operation"], proof = session) {
    if (locked || !onChange({ generation: proof.generation, revision: proof.revision, operation })) {
      setError("表单或保存状态已变化，本次操作未接收；规则填写仍保留，请重新核对。");
      return false;
    }
    setError(null);
    return true;
  }
  function ask(kind: "clear" | "cancel") {
    if (locked) return;
    setConfirmation({ kind, generation: session.generation, revision: session.revision });
  }
  function confirm() {
    if (!confirmation) return;
    const proof = { ...session, generation: confirmation.generation, revision: confirmation.revision };
    request({ kind: confirmation.kind }, proof);
    setConfirmation(null);
  }
  return <section aria-label="验收结果结构规则" className="mt-4 min-w-0 rounded-xl border border-slate-200 bg-white p-4">
    <h5 className="text-sm font-semibold text-slate-900">结果结构规则 <span className="text-xs font-normal text-slate-500">（可选）</span></h5>
    <p className="mt-1 text-xs leading-5 text-slate-500">用于检查最终结果的字段类型和必填项，不判断内容事实，也不替代原有字段检查。修改后须保存样例才生效。</p>
    <div className="mt-3"><SourceReview source={session.source} creating={creating} /></div>
    {locked ? <p className="mt-2 text-xs text-amber-800">验收运行、操作处理中或保存结果待核对时，规则编辑已锁定；已有填写仍保留。</p> : null}
    {session.edit.kind === "clear" ? <p role="status" className="mt-3 text-xs text-amber-800">本次保存将明确清除结果结构规则，名称、输入和字段检查不受此操作影响。</p> : null}
    {session.edit.kind === "replace" ? <p role="status" className="mt-3 text-xs text-amber-800">本页规则填写尚未保存。对象格式可读取不代表规则有效或验收通过，请保存后运行样例核对实际结果。</p> : null}
    {editing ? <details open className="mt-3 min-w-0 rounded-lg bg-slate-50 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-slate-600">高级开发者结构规则编辑区</summary>
      <p className="mt-2 text-xs leading-5 text-slate-500">填写 JSON 对象，根 type 必须为 object，最多32KB。保存时还会核对实际支持的规则和敏感内容；不支持的规则不会保存。</p>
      <textarea aria-label="结果结构规则（开发者格式）" disabled={locked} value={text ?? ""} rows={10} maxLength={MAX_EVALUATION_RESULT_SCHEMA_BYTES * 4} spellCheck={false}
        onChange={(event) => request({ kind: "replace", text: event.target.value })}
        className="mt-2 w-full min-w-0 rounded-lg border border-slate-200 p-3 font-mono text-xs outline-none focus:border-indigo-400 disabled:bg-slate-100" />
    </details> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      {!editing ? <Button type="button" size="sm" variant="secondary" disabled={locked} onClick={() => request({ kind: "begin" })}>编辑结果结构规则</Button> : null}
      <button ref={focus} type="button" disabled={locked} onClick={() => ask("clear")} className="min-h-9 rounded-lg px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50">明确清除结构规则</button>
      {editing || session.edit.kind === "clear" ? <Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => session.edit.kind === "keep" ? request({ kind: "cancel" }) : ask("cancel")}>取消规则填写</Button> : null}
    </div>
    {error ? <p role="alert" className="mt-2 text-xs leading-5 text-red-700">{error}</p> : null}
    <ConfirmDialog open={confirmation !== null && !locked} onOpenChange={(open) => { if (!open) setConfirmation(null); }} returnFocusRef={focus}
      title={confirmation?.kind === "clear" ? "清除本样例的结果结构规则？" : "取消本页规则填写？"}
      description={confirmation?.kind === "clear" ? "仅在下次保存样例时清除这条结构规则。名称、输入和字段检查仍保留；已运行的验收记录不变。" : "仅舍弃这条规则在本页尚未保存的填写，恢复打开表单时的规则。名称、输入和字段检查仍保留。"}
      confirmLabel={confirmation?.kind === "clear" ? "确认清除结构规则" : "确认取消规则填写"} onConfirm={confirm} />
  </section>;
}
