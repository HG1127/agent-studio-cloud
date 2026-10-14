"use client";

import { useEffect, useRef, useState } from "react";
import type { InputMapping } from "@/contracts/input-mapping";
import type { InputMappingPreviewResult } from "@/contracts/input-mapping-preview";
import type { MappingSourceOption } from "./node-input-mapping-editing";
import { InputMappingPreviewCancelledError, previewNodeInputMapping } from "./node-input-mapping-preview-client";

const statuses = { provided: "样例提供", fallback: "使用明确回退值", omitted: "未提供且允许省略", missing: "缺少必需来源" };
export function NodeInputMappingPreview({ mapping, sources, scopeKey }: {
  mapping: InputMapping; sources: MappingSourceOption[]; scopeKey: string;
}) {
  const [input, setInput] = useState("");
  const [outputs, setOutputs] = useState<{ nodeId: string; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [reply, setReply] = useState<{ key: string; result: InputMappingPreviewResult } | null>(null);
  const [invalidated, setInvalidated] = useState(false);
  const scope = JSON.stringify({ scopeKey, mapping, sources });
  const [scopeSource, setScopeSource] = useState(scope);
  const [scopeEpoch, setScopeEpoch] = useState(0);
  if (scopeSource !== scope) {
    setInvalidated(invalidated || active !== null || reply !== null);
    setScopeSource(scope); setScopeEpoch(scopeEpoch + 1); setReply(null); setActive(null); setError(null);
  }
  const sequence = useRef(0);
  const running = useRef<{ controller: AbortController; sequence: number; key: string } | null>(null);
  const key = JSON.stringify({ scopeEpoch, scopeKey, mapping, input, outputs });
  const busy = active === key;
  useEffect(() => {
    const request = running.current;
    if (request && request.key !== key) { request.controller.abort(); running.current = null; sequence.current += 1; }
  }, [key]);
  useEffect(() => () => { running.current?.controller.abort(); running.current = null; sequence.current += 1; }, []);
  function invalidate() {
    running.current?.controller.abort(); running.current = null; sequence.current += 1;
    setInvalidated(active !== null || reply !== null || invalidated); setActive(null); setReply(null); setError(null);
  }
  function cancel() {
    running.current?.controller.abort(); running.current = null; sequence.current += 1;
    setActive(null); setReply(null); setInvalidated(false);
    setError("已取消本次只读试算，原填写已保留；没有自动重新提交。");
  }
  async function submit() {
    if (busy || running.current?.key === key) return;
    let raw: unknown;
    try {
      if (!input.trim() || outputs.some((item) => !item.nodeId || !item.text.trim() || !sources.some((source) => source.id === item.nodeId))
        || new Set(outputs.map((item) => item.nodeId)).size !== outputs.length) throw new Error("Missing sample");
      raw = { mapping, input: JSON.parse(input) as unknown, outputs: Object.fromEntries(outputs.map((item) => [item.nodeId, JSON.parse(item.text) as unknown])) };
    } catch { setError("请明确填写有效的运行输入样例和成果样例。空对象也需填写，同一步骤的成果不能重复。"); return; }
    running.current?.controller.abort();
    const current = ++sequence.current;
    const submittedKey = key;
    const request = { controller: new AbortController(), sequence: current, key: submittedKey };
    running.current = request;
    setActive(submittedKey); setError(null); setReply(null); setInvalidated(false);
    try {
      const result = await previewNodeInputMapping(raw, request.controller.signal);
      if (running.current === request && current === sequence.current && !request.controller.signal.aborted) setReply({ key: submittedKey, result });
    } catch (cause) {
      if (running.current !== request || request.controller.signal.aborted || cause instanceof InputMappingPreviewCancelledError) return;
      setError("参考试算暂时无法读取，请稍后重新提交。没有执行步骤或保存设置。");
    } finally {
      if (running.current === request) { running.current = null; setActive(null); }
    }
  }
  const result = reply?.key === key ? reply.result : null;
  return <section aria-label="字段映射参考试算" className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <h4 className="text-sm font-semibold text-slate-900">只读参考试算</h4>
    <p className="text-xs leading-5 text-slate-600">仅按你填写的样例核对字段映射，不执行步骤、不保存草稿，也不证明真实来源存在或运行成功。不会自动填入样例或补全上游成果。</p>
    <label className="block text-xs text-slate-700">运行输入样例（数据格式）<textarea maxLength={512 * 1024} value={input} onChange={(event) => { invalidate(); setInput(event.target.value); }} className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 bg-white p-2 font-mono text-xs" /></label>
    {outputs.map((item, index) => <fieldset key={index} className="space-y-2 rounded-lg border border-slate-200 p-2">
      <legend className="text-xs text-slate-600">成果样例 {index + 1}</legend>
      <label className="block text-xs">样例来源步骤<select value={item.nodeId} onChange={(event) => { invalidate(); setOutputs(outputs.map((row, rowIndex) => rowIndex === index ? { ...row, nodeId: event.target.value } : row)); }} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2"><option value="">明确选择来源</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}{item.nodeId && !sources.some((source) => source.id === item.nodeId) ? <option value={item.nodeId}>原样例来源目前无法核对</option> : null}</select></label>
      <label className="block text-xs">成果样例内容（数据格式）<textarea maxLength={256 * 1024} value={item.text} onChange={(event) => { invalidate(); setOutputs(outputs.map((row, rowIndex) => rowIndex === index ? { ...row, text: event.target.value } : row)); }} className="mt-1 min-h-16 w-full rounded-lg border border-slate-200 bg-white p-2 font-mono text-xs" /></label>
      <button type="button" onClick={() => { invalidate(); setOutputs(outputs.filter((_, rowIndex) => rowIndex !== index)); }} className="text-xs text-slate-600">移除本条试算样例</button>
    </fieldset>)}
    <div className="flex flex-wrap gap-3"><button type="button" onClick={() => { invalidate(); setOutputs([...outputs, { nodeId: "", text: "" }]); }} className="text-xs font-semibold text-indigo-700">添加成果样例</button><button type="button" disabled={busy} onClick={() => void submit()} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 disabled:opacity-50">{busy ? "正在只读试算…" : "提交样例做只读试算"}</button>{busy ? <button type="button" onClick={cancel} className="text-xs font-semibold text-slate-600">取消本次试算</button> : null}</div>
    {error ? <p role="alert" className="text-xs text-amber-900">{error}</p> : null}
    {(invalidated || reply && reply.key !== key || active && active !== key) ? <p role="status" className="text-xs text-slate-600">映射或样例已经变化，之前的试算不再适用，请明确重新提交。</p> : null}
    {result ? <div aria-label="本次只读试算结果" className="space-y-2">
      <p role={result.ok ? "status" : "alert"} className="text-xs leading-5 text-slate-700">{result.ok ? "样例映射试算完成，未执行或保存；结果仅对应本次提交的样例。" : result.error}</p>
      {result.fields.length ? <ol className="space-y-1 text-xs text-slate-600">{result.fields.map((field, index) => <li key={index}>目标逐层名称：{field.target.map((segment) => "「" + segment + "」").join(" → ")}；{statuses[field.status]}</li>)}</ol> : null}
      {result.ok ? <><pre aria-label="试算后的输入" className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white p-2 text-xs">{JSON.stringify(result.input, null, 2)}</pre><p className="text-xs text-slate-600">{result.includesUpstreamOutputs ? "按配置携带了本次明确填写的成果样例，不代表携带全部真实成果。" : "未额外携带上游成果。"}</p></> : null}
    </div> : null}
  </section>;
}
