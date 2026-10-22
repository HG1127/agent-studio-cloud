"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { WorkflowDraft, WorkflowNode, WorkflowOutputField } from "@/contracts/workflow";
import { MAX_OUTPUT_PREVIEW_BODY_BYTES, MAX_OUTPUT_PREVIEW_RESULT_BYTES, MAX_OUTPUT_PREVIEW_SAMPLES_BYTES, type WorkflowOutputPreviewResult } from "@/contracts/workflow-output-preview";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OutputPreviewReadError, outputPreviewMessage, prepareWorkflowOutputPreview, requestWorkflowOutputPreview } from "./workflow-output-preview-client";

type SnapshotField = { field: WorkflowOutputField; label: string; sourceLabel: string };
type PreviewState = { signature: string; fields: SnapshotField[]; result?: WorkflowOutputPreviewResult; message: string };

const statusLabels = {
  provided: "参考值已采用", omitted: "可选项已省略", missing: "必填参考值缺失", invalid: "参考值无效",
};

function structureLabel(value: unknown): string {
  if (value === null) return "空值";
  if (Array.isArray(value)) return "列表，包含 " + value.length + " 项";
  if (typeof value === "object" && value) return "对象，包含 " + Object.keys(value).length + " 项";
  if (typeof value === "string") return value.length ? "文字，共 " + value.length + " 字符" : "空文字";
  if (typeof value === "boolean") return value ? "是 / 否值：是" : "是 / 否值：否";
  if (typeof value === "number") return "数字：" + value;
  return "未提供";
}

function fieldValue(result: Record<string, unknown>, path: string): unknown {
  return path.trim().split(".").reduce<unknown>((value, part) => {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    return (value as Record<string, unknown>)[part];
  }, result);
}

export function WorkflowOutputPreview({ workflow, sources, sourceLabels }: {
  workflow: WorkflowDraft;
  sources: readonly WorkflowNode[];
  sourceLabels?: Readonly<Record<string, string>>;
}) {
  const id = useId();
  const definitionKey = JSON.stringify({ workflow, sources, sourceLabels });
  const [definition, setDefinition] = useState({ key: definitionKey, revision: 0 });
  const [values, setValues] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; sourceIndex?: number } | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const running = useRef<{ controller: AbortController; signature: string } | null>(null);
  const clearButton = useRef<HTMLButtonElement>(null);
  const inputs = useRef<Array<HTMLTextAreaElement | null>>([]);
  if (definition.key !== definitionKey) setDefinition({ key: definitionKey, revision: definition.revision + 1 });
  const signature = definitionKey + ":" + definition.revision + ":" + revision;
  const pending = pendingSignature !== null;
  const stale = Boolean(preview && preview.signature !== signature);
  const current = !stale ? preview : null;
  const labelFor = (node: WorkflowNode, index: number) => sourceLabels?.[node.id]?.trim() || node.title.trim() || "来源步骤 " + (index + 1);

  useEffect(() => {
    if (running.current && running.current.signature !== signature) running.current.controller.abort();
  }, [signature]);
  useEffect(() => () => { running.current?.controller.abort(); running.current = null; }, []);

  async function submit() {
    if (running.current || !sources.length || !workflow.outputContract?.fields.length) return;
    setError(null);
    const prepared = prepareWorkflowOutputPreview(workflow, sources, values);
    if (!prepared.ok) {
      setError({ message: prepared.error, sourceIndex: prepared.sourceIndex });
      if (prepared.sourceIndex !== undefined) inputs.current[prepared.sourceIndex]?.focus();
      return;
    }
    const snapshot = prepared.input.workflow.outputContract?.fields.map((field, index) => ({
      field,
      label: field.label?.trim() || "交付字段 " + (index + 1),
      sourceLabel: sources.find((source) => source.id === field.sourceNodeId)
        ? labelFor(sources.find((source) => source.id === field.sourceNodeId)!, sources.findIndex((source) => source.id === field.sourceNodeId))
        : "来源未在当前参考列表中",
    })) ?? [];
    const request = { controller: new AbortController(), signature };
    running.current = request;
    setPendingSignature(signature);
    setPreview(null);
    try {
      const result = await requestWorkflowOutputPreview(prepared.body, request.controller.signal);
      if (running.current !== request || request.controller.signal.aborted) return;
      setPreview({ signature, fields: snapshot, result, message: outputPreviewMessage(result) });
    } catch (cause) {
      if (running.current !== request) return;
      const failure = cause instanceof OutputPreviewReadError ? cause : new OutputPreviewReadError("unknown");
      setPreview({ signature, fields: snapshot, message: outputPreviewMessage(failure) });
    } finally {
      if (running.current === request) { running.current = null; setPendingSignature(null); }
    }
  }

  function cancel() {
    running.current?.controller.abort();
    running.current = null;
    setPendingSignature(null);
    setPreview(null);
    setError({ message: outputPreviewMessage(new OutputPreviewReadError("cancelled")) });
  }
  function clear() {
    if (confirmation !== signature) {
      setError({ message: "流程或参考值已变化，请重新确认清除。原填写已保留。" });
      setConfirmation(null);
      return;
    }
    setValues({}); setRevision((value) => value + 1); setPreview(null); setError(null); setConfirmation(null);
  }

  return <section aria-labelledby={id + "-title"} className="rounded-xl border border-slate-200 bg-white p-4">
    <h3 id={id + "-title"} className="text-sm font-semibold text-slate-950">交付参考数据试算</h3>
    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">只试算参考数据，不执行、不保存、不证明真实交付或质量。</p>
    <p className="mt-2 text-xs leading-5 text-slate-600">按来源步骤填写参考值，留空不会补入示例。全部填写只留在本页内存；请勿填写密码、密钥或其他凭据。</p>
    <p className="mt-1 text-[11px] leading-5 text-slate-500">参考值合计最多 {MAX_OUTPUT_PREVIEW_SAMPLES_BYTES / 1024} 千字节，完整请求最多 {MAX_OUTPUT_PREVIEW_BODY_BYTES / 1024} 千字节，响应最多 {MAX_OUTPUT_PREVIEW_RESULT_BYTES / 1024} 千字节；按实际编码容量核对。</p>
    {!sources.length ? <p className="mt-3 rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-600">当前没有可用的参考来源，请先核对流程中的业务步骤。</p> : <ol aria-label="交付参考来源" className="mt-3 space-y-3">
      {sources.map((source, index) => <li key={source.id} className="min-w-0 rounded-lg border border-slate-200 p-3">
        <h4 className="break-words text-sm font-semibold text-slate-900">{labelFor(source, index)}</h4>
        <label htmlFor={id + "-source-" + index} className="mt-2 block text-xs font-medium text-slate-600">参考值（数据格式）</label>
        <textarea id={id + "-source-" + index} ref={(element) => { inputs.current[index] = element; }}
          aria-label={labelFor(source, index) + "的参考值"} aria-describedby={id + "-format"}
          aria-invalid={error?.sourceIndex === index} value={Object.hasOwn(values, source.id) ? values[source.id] : ""} rows={4}
          className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 p-2 font-mono text-xs leading-5"
          onChange={(event) => { const text = event.target.value; setValues((current) => ({ ...current, [source.id]: text })); setRevision((value) => value + 1); setError(null); }} />
      </li>)}
    </ol>}
    <p id={id + "-format"} className="mt-2 text-xs leading-5 text-slate-500">文字需要双引号；也可以填写数字、是 / 否值、对象或列表。空值与空内容是否可用，由实际试算结果判断。条件参考值只作为数据，不表示任何路径已执行。</p>
    {!workflow.outputContract?.fields.length ? <p className="mt-2 text-xs leading-5 text-amber-800">尚未定义最终交付字段，暂时无法核对约定的交付结构。</p> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={submit} disabled={pending || !sources.length || !workflow.outputContract?.fields.length} aria-busy={pending} className="min-h-9 rounded-lg bg-indigo-700 px-3 text-xs font-semibold text-white disabled:opacity-40">{pending ? "正在试算参考数据…" : "试算这些参考值"}</button>
      {pending ? <button type="button" onClick={cancel} className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700">取消本次试算</button> : null}
      <button ref={clearButton} type="button" disabled={pending || !Object.values(values).some((value) => value.length)} onClick={() => setConfirmation(signature)} className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40">清除参考值</button>
    </div>
    {pending ? <p role="status" className="mt-3 text-xs leading-5 text-slate-600">{pendingSignature === signature ? "本次只读取试算结果，请等待或取消；不会自动重发。" : "流程或参考值已变化，正在舍弃旧请求；不会自动重发。可取消后手动试算。"}</p> : null}
    {error ? <p role="alert" className="mt-3 text-xs leading-5 text-amber-900">{error.message}</p> : null}
    {stale ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">流程或参考值已变化，上次结果已过期。请手动重新试算；当前没有可采用的新结果。</p> : null}
    {current ? <div aria-label="本次参考数据试算结果" className="mt-4 space-y-3 rounded-lg border border-slate-200 p-3">
      <p role={current.result?.ok ? "status" : "alert"} className="text-xs leading-5 text-slate-700">{current.message}</p>
      {current.result ? <>
        <ol aria-label="提交时交付字段核对" className="space-y-2">{current.fields.map(({ field, label, sourceLabel }, index) => {
          const matches = current.result!.fields.filter((item) => item.path === field.path);
          const status = matches.length === 1 ? matches[0].status : undefined;
          return <li key={index} className="rounded-lg bg-slate-50 p-3 text-xs">
            <h4 className="font-semibold text-slate-900">{label}</h4>
            <p className="mt-1 break-words text-slate-600">提交时来源：{sourceLabel} · {field.required ? "必须产出" : "可选交付"}</p>
            <p className="mt-1 text-slate-700">{status ? statusLabels[status] : "未返回可核对的字段状态"}</p>
            {current.result!.ok && status === "provided" ? <p className="mt-1 text-slate-600">参考结构：{structureLabel(fieldValue(current.result!.result, field.path))}</p> : null}
          </li>;
        })}</ol>
        {current.result.ok && Object.keys(current.result.result).length === 0 ? <p className="text-xs text-slate-600">本次试算结构为空，没有提供交付内容；可选项可能已全部省略。</p> : null}
        {current.result.ok ? <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold">核对试算原始结构（开发者数据）</summary>
          <p className="mt-2 leading-5">以下为本次参考数据组合；关联值仅是样例，不代表真实执行路径或完成证据。</p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3">{JSON.stringify(current.result.result, null, 2)}</pre>
        </details> : null}
      </> : null}
    </div> : null}
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }}
      title="清除本页参考值？" description="将清除本页内存中的全部参考填写和试算结果，不改动流程草稿。返回可保留原填写。"
      confirmLabel="确认清除参考值" onConfirm={clear} returnFocusRef={clearButton} />
  </section>;
}
