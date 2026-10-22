"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { McpConnectionConfigurationResult } from "@/contracts/mcp-connection";

type ConfigurationState = { kind: "loading" | "unknown" | "error" } | { kind: "ready"; result: McpConnectionConfigurationResult };

const statusText = {
  configured: "已配置",
  "partially-configured": "部分配置需要处理",
  "not-configured": "尚未登记连接",
  "configuration-error": "配置错误",
} satisfies Record<McpConnectionConfigurationResult["status"], string>;

async function readConfiguration(signal: AbortSignal): Promise<ConfigurationState> {
  let response: Response;
  try {
    response = await fetch("/api/mcp/connections/configuration", { method: "GET", cache: "no-store", credentials: "same-origin", signal });
  } catch {
    return { kind: "error" };
  }
  if (!response.ok) return { kind: "error" };
  let body: unknown;
  try { body = await response.json(); } catch { return { kind: "unknown" }; }
  const parsed = McpConnectionConfigurationResult.safeParse(body);
  return parsed.success ? { kind: "ready", result: parsed.data } : { kind: "unknown" };
}

export function McpConfigurationStatus() {
  const [state, setState] = useState<ConfigurationState>({ kind: "loading" });
  const mounted = useRef(false);
  const generation = useRef(0);
  const reading = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      reading.current?.abort();
      reading.current = null;
    };
  }, []);

  const read = useCallback(() => {
    if (!mounted.current || reading.current) return;
    const currentGeneration = ++generation.current;
    const controller = new AbortController();
    reading.current = controller;
    setState({ kind: "loading" });
    const finish = (next: ConfigurationState) => {
      if (reading.current !== controller) return;
      reading.current = null;
      if (!mounted.current || controller.signal.aborted || generation.current !== currentGeneration) return;
      setState(next);
    };
    void readConfiguration(controller.signal).then(finish, () => finish({ kind: "error" }));
  }, []);

  useEffect(() => { read(); }, [read]);

  const result = state.kind === "ready" ? state.result : null;
  const configured = result?.connections.filter((connection) => connection.status === "configured").length ?? 0;

  return <section aria-labelledby="mcp-configuration-title" aria-busy={state.kind === "loading"} className="content-card">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><h2 id="mcp-configuration-title" className="section-title">连接配置状态</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">仅核对服务端本地登记声明。配置通过不代表远端在线、获得业务授权或工具调用成功。</p></div>
      <button type="button" disabled={state.kind === "loading"} onClick={read} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">重新读取配置</button>
    </div>
    {state.kind === "loading" && <p role="status" className="mt-4 text-sm text-slate-500">正在读取连接配置状态…</p>}
    {state.kind === "error" && <div role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"><p className="font-semibold">配置状态读取失败</p><p>当前无法确认配置状态，请重新读取配置。这不代表未配置或配置错误。</p></div>}
    {state.kind === "unknown" && <div role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"><p className="font-semibold">配置返回的信息无法核对</p><p>当前配置状态未知，请重新读取配置。这不代表未配置或配置错误。</p></div>}
    {result && <>
      <div role="status" aria-live="polite" className={`mt-4 rounded-xl p-4 text-sm leading-6 ${result.status === "configured" ? "bg-emerald-50 text-emerald-900" : result.status === "not-configured" ? "bg-slate-50 text-slate-700" : "bg-amber-50 text-amber-900"}`}>
        <h3 className="font-semibold">{statusText[result.status]}</h3>
        {result.status === "configured" && <p>登记配置检查通过；尚未检查远端服务。</p>}
        {result.status === "partially-configured" && <p>部分登记配置通过，其他登记需要管理员处理。各项配置状态分别保留，不据此判断远端可用性。</p>}
        {result.status === "not-configured" && <p>尚未登记可核对的连接，请联系管理员在服务端登记。</p>}
        {result.status === "configuration-error" && <p>{result.connections.length === 0 ? "当前登记配置未通过核对，无法取得可展示条目；这不代表尚未登记连接。" : "当前这些登记配置未通过核对，请联系管理员处理。"}</p>}
        <p className="mt-2">{result.status === "configuration-error" && result.connections.length === 0 ? "登记条目清单无法核对，数量未知" : <>当前配置快照共 {result.connections.length} 项登记条目：配置通过 {configured} 项 · 配置错误 {result.connections.length - configured} 项。</>}</p>
      </div>
      {result.connections.length > 0 && <ul aria-label="配置诊断登记条目" className="mt-4 space-y-3">{result.connections.map((connection) => <li key={connection.id} className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-4"><h4 className="min-w-0 break-words font-semibold text-slate-900">{connection.name}</h4><p className={`text-sm leading-6 ${connection.status === "configured" ? "text-emerald-700" : "text-amber-800"}`}>{connection.status === "configured" ? "配置通过；尚未检查远端服务。" : "配置错误，请联系管理员核对服务端登记。"}</p></li>)}</ul>}
    </>}
    <p className="mt-4 text-xs leading-5 text-slate-500">此配置快照与下方连接检查分别读取，不自动合并结果；登记条目数不代表独立服务器数量。</p>
    <p className="mt-1 text-xs leading-5 text-slate-500">本页不收集地址或凭据，也不能新增、修改、删除连接或管理账号授权。重新读取配置不会检查远端或执行业务工具。</p>
  </section>;
}
