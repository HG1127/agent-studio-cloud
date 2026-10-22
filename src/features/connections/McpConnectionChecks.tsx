"use client";

import { useEffect, useRef, useState } from "react";
import type { McpConnectionCheckResult, McpConnectionStatus } from "@/contracts/mcp-connection";
import { checkRegisteredConnection, readRegisteredConnections } from "./mcp-connection-client";
import { createMcpCheckBatch, summarizeMcpChecks, type McpCheckBatch, type McpCheckEntry, type McpCheckSnapshot } from "./mcp-check-batch";

const statusText = {
  available: "连接与工具定义检查通过",
  "credentials-rejected": "服务拒绝了访问凭据",
  "definition-changed": "工具目录或字段定义已变化",
  "protocol-error": "服务返回的信息无法核对",
  unavailable: "暂时无法确认连接状态",
  "not-found": "此登记已不存在",
  "configuration-error": "服务端登记需要处理",
} satisfies Record<McpConnectionStatus, string>;

const nextStep = {
  available: "本次仅核对连接与登记的输入定义。实际调用、输出结果、写入防重和业务授权仍需在运行时验证。",
  "credentials-rejected": "请联系管理员核对服务端凭据及访问权限，再重新检查。",
  "definition-changed": "请联系管理员复核登记的工具与输入字段，更新流程绑定后重新发布。",
  "protocol-error": "请联系管理员核对服务协议和目录内容，再重新检查。",
  unavailable: "可能遇到网络或服务故障，暂时不能判断是否可用。可稍后重新检查。",
  "not-found": "请重新读取连接目录，确认管理员当前的登记。",
  "configuration-error": "请联系管理员核对服务端登记，本页不能修改地址或凭据。",
} satisfies Record<McpConnectionStatus, string>;

function CheckResult({ result, fieldToolIds = [], onLocateFields }: { result: McpConnectionCheckResult; fieldToolIds?: readonly string[]; onLocateFields?: (id: string) => void }) {
  return <>
    <p className={`font-semibold ${result.status === "available" ? "text-emerald-700" : "text-amber-800"}`}>{statusText[result.status]}</p>
    <p>{nextStep[result.status]}</p>
    {result.tools.length === 0 ? <p className="mt-2">本次没有可展示的已登记工具。</p> : <ul aria-label="已登记工具核对结果" className="mt-3 space-y-1">
      {result.tools.map((tool) => <li key={tool.registryToolId} className="flex flex-wrap items-center justify-between gap-2"><span className="break-words">{tool.name}</span><span>{tool.status === "available" ? "定义一致" : tool.status === "missing" ? "目录中未找到" : "定义已变化"}</span>{onLocateFields && fieldToolIds.includes(tool.registryToolId) ? <button type="button" onClick={() => onLocateFields(tool.registryToolId)} aria-label={`查看${tool.name}的本页登记字段`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-500">查看本页登记字段</button> : onLocateFields ? <span className="text-xs text-amber-800">本页没有可唯一对应的登记字段说明。</span> : null}</li>)}
    </ul>}
    {onLocateFields && result.tools.length > 0 && <p className="mt-2 text-xs leading-5 text-slate-500">仅查看本次页面读取的登记字段说明；不代表它与本次远端核对的字段一致，也不能替代实际远端定义或业务授权。目录中未找到或定义变化的条目也仅作登记参考。</p>}
  </>;
}

function ConnectionCheck({ entry: { connection, state }, disabled, waiting, onCheck, fieldToolIds, onLocateFields }: {
  entry: McpCheckEntry; disabled: boolean; waiting: boolean; onCheck: () => void; fieldToolIds: readonly string[]; onLocateFields?: (id: string) => void;
}) {
  return <li className="rounded-xl border border-slate-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <h3 className="min-w-0 break-words font-semibold text-slate-900">{connection.name}</h3>
      <button type="button" disabled={disabled} onClick={onCheck} aria-label={`检查${connection.name}的连接与工具目录`} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50">{state.kind === "checking" ? "正在检查…" : "检查连接与工具目录"}</button>
    </div>
    <div role="status" aria-live="polite" className="mt-3 text-sm leading-6 text-slate-600">
      {waiting && <p>本次尚未安排到此项，等待前一项检查结束。</p>}
      {state.kind === "unknown" && <p>尚未检查，暂时不能判断是否可用。</p>}
      {state.kind === "checking" && <p>正在核对连接与工具目录，请稍候。</p>}
      {state.kind === "uncertain" && <><p className="font-semibold text-amber-800">本次检查结果未取得</p><p>网络或响应可能异常，暂时不能判断是否可用。请稍后重试。</p></>}
      {state.kind === "result" && <>{waiting && <p className="mt-2 font-semibold">此目录范围内保留的上次结果</p>}<CheckResult result={state.result} fieldToolIds={fieldToolIds} onLocateFields={onLocateFields} /></>}
      {(state.kind === "checking" || state.kind === "uncertain") && state.previous && <details className="mt-3"><summary className="cursor-pointer">查看此目录范围内的上次结果</summary><CheckResult result={state.previous} /></details>}
    </div>
  </li>;
}

type DirectoryState = { kind: "loading" | "failed" } | { kind: "ready"; batch: McpCheckBatch; snapshot: McpCheckSnapshot };

export function McpConnectionChecks({ fieldToolIds = [], onLocateFields, onDirectoryReread }: { fieldToolIds?: readonly string[]; onLocateFields?: (id: string) => void; onDirectoryReread?: () => void } = {}) {
  const [directory, setDirectory] = useState<DirectoryState>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  const current = useRef<McpCheckBatch | null>(null);
  const reading = useRef<AbortController | null>(null);
  const directoryBusy = useRef(true);
  const scope = useRef(0);
  useEffect(() => {
    const readScope = ++scope.current;
    const controller = new AbortController();
    reading.current = controller;
    directoryBusy.current = true;
    void readRegisteredConnections(controller.signal).then((connections) => {
      if (controller.signal.aborted || scope.current !== readScope) return;
      const batch: McpCheckBatch = createMcpCheckBatch(connections, checkRegisteredConnection, (snapshot) => {
        if (scope.current === readScope && current.current === batch) setDirectory({ kind: "ready", batch, snapshot });
      });
      current.current = batch;
      directoryBusy.current = false;
      reading.current = null;
      setDirectory({ kind: "ready", batch, snapshot: batch.getSnapshot() });
    }).catch(() => {
      if (controller.signal.aborted || scope.current !== readScope) return;
      directoryBusy.current = false;
      reading.current = null;
      setDirectory({ kind: "failed" });
    });
    return () => {
      controller.abort();
      if (scope.current === readScope) {
        scope.current += 1;
        current.current?.dispose();
        current.current = null;
        reading.current = null;
      }
    };
  }, [revision]);

  function reload() {
    if (directoryBusy.current) return;
    directoryBusy.current = true;
    onDirectoryReread?.();
    scope.current += 1;
    reading.current?.abort();
    current.current?.dispose();
    current.current = null;
    setDirectory({ kind: "loading" });
    setRevision((value) => value + 1);
  }

  const snapshot = directory.kind === "ready" ? directory.snapshot : null;
  const busy = snapshot?.phase === "running" || snapshot?.phase === "stopping";
  const summary = snapshot ? summarizeMcpChecks(snapshot.entries) : null;

  return <section aria-labelledby="connection-check-title" className="content-card">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h2 id="connection-check-title" className="section-title">已登记连接检查</h2><p className="mt-2 text-sm leading-6 text-slate-600">只检查管理员登记的连接及工具输入定义。检查不执行业务工具，也不修改授权。</p><p className="mt-1 text-xs leading-5 text-slate-500">批量检查逐项核对当前已读取的登记条目；条目数量不代表独立服务器数量。</p></div><button type="button" onClick={reload} disabled={directory.kind === "loading"} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">重新读取目录</button></div>
    {directory.kind === "loading" && <p role="status" className="mt-4 text-sm text-slate-500">正在读取已登记连接…</p>}
    {directory.kind === "failed" && <p role="alert" className="mt-4 text-sm text-amber-800">连接目录暂时无法读取，请重新读取目录。当前不能判断是否有已登记连接。</p>}
    {directory.kind === "ready" && (directory.snapshot.entries.length === 0 ? <p role="status" className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">当前没有可供检查的已登记连接。请联系管理员在服务端核对登记。</p> : <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4">
        <div role="status" aria-live="polite" className="text-sm leading-6 text-slate-600">
          <p>当前已读取 {directory.snapshot.entries.length} 项登记条目</p>
          <p>当前保留结果：通过 {summary?.passed} 项 · 未通过 {summary?.failed} 项 · 尚无法判断 {summary?.unknown} 项</p>
          {directory.snapshot.phase !== "idle" && <p>本次已结束 {directory.snapshot.completed} / {directory.snapshot.total} 项检查</p>}
          {directory.snapshot.mode === "all" && directory.snapshot.phase === "running" && <p>正在逐项检查，每次只安排一项。</p>}
          {directory.snapshot.phase === "stopping" && <p>已停止安排后续检查；当前已发请求仍在等待回复。</p>}
          {directory.snapshot.phase === "stopped" && <p>已停止安排后续检查，已取得的结果保留在当前目录范围内。</p>}
          {directory.snapshot.mode === "all" && (directory.snapshot.phase === "stopping" || directory.snapshot.phase === "stopped") && directory.snapshot.completed < directory.snapshot.total && <p>未安排的条目保留此目录范围内的此前结果；尚未检查过的条目仍无法判断。</p>}
          {directory.snapshot.mode === "all" && directory.snapshot.phase === "completed" && <p>本次逐项检查已结束，未取得有效回复的条目仍无法判断。</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => { if (current.current === directory.batch) directory.batch.startAll(); }} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">检查全部已登记条目</button>
          {directory.snapshot.mode === "all" && busy && <button type="button" disabled={directory.snapshot.phase === "stopping"} onClick={() => { if (current.current === directory.batch) directory.batch.stop(); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">停止安排后续检查</button>}
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">停止只影响后续安排，不等于服务端取消当前请求。重新读取目录后，旧范围的检查结果不会带入新清单。</p>
      <ul aria-label="当前登记条目检查" className="mt-4 space-y-3">{directory.snapshot.entries.map((entry, index) => <ConnectionCheck key={entry.connection.id} entry={entry} disabled={busy} waiting={directory.snapshot.phase === "running" && directory.snapshot.mode === "all" && index > directory.snapshot.completed} fieldToolIds={fieldToolIds} onLocateFields={onLocateFields ? (id) => { if (!directoryBusy.current && current.current === directory.batch) onLocateFields(id); } : undefined} onCheck={() => { if (current.current === directory.batch) directory.batch.startOne(entry.connection.id); }} />)}</ul>
    </>)}
  </section>;
}
