"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ToolOperationGetResult, ToolOperationResolveInput, ToolOperationView } from "@/contracts/tool-operation";
import { createToolOperationHistoryReader } from "./tool-operation-history-reader";

const buttonClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50";

export type ToolOperationHistoryReadState = ReturnType<ReturnType<typeof createToolOperationHistoryReader>["getSnapshot"]>;

export function ToolOperationHistoryReader({ payload, sourceRunId, requestGeneration, readEnabled, read, hashPayload, onRecorded, onUnconfirmed, onStateChange, readLabel = "手动读取原请求历史", announce = true, knownRecorded = false }: {
  payload: ToolOperationResolveInput;
  sourceRunId: ToolOperationView["sourceRunId"];
  requestGeneration: number;
  readEnabled: boolean;
  read: (operationId: ToolOperationResolveInput["operationId"], signal: AbortSignal) => Promise<ToolOperationGetResult>;
  hashPayload: (payload: ToolOperationResolveInput) => Promise<string | null>;
  onRecorded: (operation: ToolOperationView, payload: ToolOperationResolveInput, sourceRunId: ToolOperationView["sourceRunId"], requestGeneration: number) => void;
  onUnconfirmed?: (operation: ToolOperationView, payload: ToolOperationResolveInput, sourceRunId: ToolOperationView["sourceRunId"], requestGeneration: number, requestHash: string | null) => void;
  onStateChange?: (state: ToolOperationHistoryReadState) => void;
  readLabel?: string;
  announce?: boolean;
  knownRecorded?: boolean;
}) {
  const [reader] = useState(createToolOperationHistoryReader);
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getServerSnapshot);
  const readButton = useRef<HTMLButtonElement>(null);
  const restoreReadFocus = useRef(false);

  useLayoutEffect(() => { reader.connect(); return () => reader.disconnect(); }, [reader]);
  useLayoutEffect(() => { reader.bind(payload, sourceRunId, requestGeneration, readEnabled, { read, hashPayload, onRecorded, onUnconfirmed }); });
  useLayoutEffect(() => { onStateChange?.(state); }, [state, onStateChange]);
  useLayoutEffect(() => {
    if (restoreReadFocus.current && !state.canAbort) {
      restoreReadFocus.current = false;
      if (state.canRead) readButton.current?.focus();
    }
  }, [state.canAbort, state.canRead]);

  return <section aria-label="核对原请求历史" className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <h4 className="text-sm font-semibold text-slate-900">核对原请求历史</h4>
    <p role={announce ? state.phase === "unknown" ? "alert" : "status" : undefined} aria-live={announce ? "polite" : undefined} className="text-sm leading-6 text-slate-700">{knownRecorded && state.phase === "unknown" ? "原核对结论已有保存确认。可手动核对最新历史；中止或未读到历史不会撤销这份保存确认。" : state.message}</p>
    <div className="flex flex-wrap gap-2">
      <button ref={readButton} type="button" disabled={!state.canRead} aria-busy={state.canAbort} onClick={() => void reader.read()} className={buttonClass}>{readLabel}</button>
      {state.canAbort ? <button type="button" onClick={() => { restoreReadFocus.current = true; reader.abort(); }} className={buttonClass}>中止本次读取</button> : null}
    </div>
    <p className="text-xs leading-5 text-slate-500">中止只结束这次历史读取，不撤销原提交，也不解除未知提交的离页保护。历史最多显示 50 条；未找到记录或证据不足时仍是未知。</p>
  </section>;
}
