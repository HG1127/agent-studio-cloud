"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { PublicToolView } from "@/contracts/public-agent-tool";
import { Button } from "@/components/ui/button";
import { WorkspaceTabs } from "@/components/ui/WorkspaceTabs";
import { buildPublicToolServerGuide } from "./public-tool-server-guide";

export function PublicToolServerGuide({ tool }: { tool: PublicToolView }) {
  return <details className="min-w-0 rounded-xl border border-slate-200 p-4">
    <summary className="cursor-pointer text-sm font-semibold text-slate-800">服务端接入说明（开发者）</summary>
    {tool.status === "enabled" && tool.publication
      ? <ServerGuideEditor key={tool.toolId + ":" + tool.revision} tool={tool} />
      : <p className="mt-3 text-sm leading-6 text-slate-600">工具尚未开放或已经停用。请先明确发布并重新核对状态，再准备接入说明；不会提供可调用的示例。</p>}
  </details>;
}

function ServerGuideEditor({ tool }: { tool: PublicToolView }) {
  const id = useId();
  const [address, setAddress] = useState("");
  const [checked, setChecked] = useState(0);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const epoch = useRef(0);
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; epoch.current += 1; }; }, []);
  const guide = checked ? buildPublicToolServerGuide(address, tool.toolId) : null;
  const addressError = guide?.ok === false ? guide.error : null;
  useLayoutEffect(() => { if (addressError) addressRef.current?.focus(); }, [addressError, checked]);
  function edit(value: string) { epoch.current += 1; setAddress(value); setChecked(0); setMessage(null); }
  async function copy(text: string, label: string, textarea: HTMLTextAreaElement | null) {
    const stamp = ++epoch.current;
    setMessage(null);
    try {
      await navigator.clipboard.writeText(text);
      if (live.current && stamp === epoch.current) setMessage({ error: false, text: "已复制" + label + "，不含真实凭据；请先完成占位内容。" });
    } catch {
      if (!live.current || stamp !== epoch.current) return;
      setMessage({ error: true, text: "复制不可用，请手动选中说明后复制；没有发起工具调用。" });
      if (textarea?.isConnected && !textarea.closest("[hidden], details:not([open])")) { textarea.focus(); textarea.select(); }
    }
  }
  function code(label: string, text: string) {
    const codeId = id + "-" + label;
    return <div className="min-w-0 space-y-2"><label htmlFor={codeId} className="block text-xs font-semibold text-slate-700">{label}</label>
      <textarea id={codeId} readOnly spellCheck={false} rows={Math.min(14, text.split("\n").length + 1)} value={text}
        className="w-full min-w-0 resize-y rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100" />
      <Button type="button" size="sm" variant="secondary" onClick={(event) => {
        const textarea = event.currentTarget.parentElement?.querySelector("textarea") ?? null;
        void copy(text, label, textarea);
      }}>复制{label}</Button></div>;
  }
  return <div className="mt-4 min-w-0 space-y-4">
    <p className="text-sm leading-6 text-slate-600">用自己的服务端调用已发布工具。这里只整理现有接口说明，不发起请求、不读取或复制管理凭据和调用凭据，也不代表地址已验证可访问。</p>
    <form noValidate onSubmit={(event) => { event.preventDefault(); epoch.current += 1; setChecked((current) => current + 1); setMessage(null); }} className="space-y-2">
      <label htmlFor={id + "-address"} className="block text-sm font-medium">服务端站点地址</label>
      <input id={id + "-address"} ref={addressRef} type="url" maxLength={2048} value={address} autoComplete="off" spellCheck={false}
        placeholder="https://你的服务站点" onChange={(event) => edit(event.target.value)} aria-invalid={guide?.ok === false || undefined}
        aria-describedby={id + "-address-help" + (guide?.ok === false ? " " + id + "-address-error" : "")}
        className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 aria-invalid:border-red-400" />
      <p id={id + "-address-help"} className="text-xs leading-5 text-slate-500">只填本站部署的完整站点地址，不含路径或凭据。当前站点地址也可能只是本机调试地址；不会自动读取公网部署配置。</p>
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm">整理接入说明</Button><Button type="button" size="sm" variant="ghost" onClick={() => edit(window.location.origin)}>填入当前站点地址</Button></div>
      {guide?.ok === false ? <p id={id + "-address-error"} role="alert" className="text-sm text-red-700">{guide.error}</p> : null}
    </form>
    {guide?.ok ? <>
      <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-950">{guide.local ? "这是本机调试地址，不是已验证的公网服务。" : "这个地址由你填写，尚未验证可访问。"} 当前说明依据最后读到的第 {tool.publication?.version} 版；接口不能锁定该版本，实际发布绑定以调用回执为准。</p>
      <ol className="list-inside list-decimal space-y-2 text-sm leading-6 text-slate-700">
        <li>在自己的服务端安全配置环境变量 <code>PUBLIC_TOOL_TOKEN</code>，使用工具调用凭据，不能使用管理凭据；不要放入网页、链接、日志或请求正文。</li>
        <li>填写下方 <code>request.json</code>：首次生成一个 UUID 后保留它，再按实际输入契约填写 <code>input</code>。空对象只是结构占位，不是业务数据。</li>
        <li>首次提交可能产生真实任务和费用。超时或状态未知时先只读查询；需要重试时，保持原 UUID、完整输入和同一调用凭据，不自动重发。</li>
      </ol>
      <details className="min-w-0 rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold">本次发布绑定的输入字段参考</summary>
        {tool.publication?.inputContract.fields.length ? <ul className="mt-2 space-y-1 text-xs">{tool.publication.inputContract.fields.map((field) => <li key={field.name} className="break-all"><code>{field.name}</code> · {field.type} · {field.required ? "必填" : "选填"}</li>)}</ul>
          : <p className="mt-2 text-xs">本次绑定未声明输入字段；实际接受的输入仍以服务端检查为准。</p>}
      </details>
      {code("待填写请求文件", guide.requestJson)}
      <WorkspaceTabs label="服务端示例语言" onValueChange={() => { epoch.current += 1; setMessage(null); }} tabs={[
        { id: "curl", label: "命令行", content: <div className="min-w-0 space-y-4"><p className="text-xs leading-5 text-slate-500">以下用于支持 Bash 语法和 --fail-with-body 的 cURL。Windows 可使用服务端脚本示例。查询前将 PUBLIC_TOOL_REQUEST_ID 设为 request.json 中原来的 UUID，不要另生成。</p>{code("首次提交命令", guide.curlPost)}{code("只读查询命令", guide.curlGet)}</div> },
        { id: "node", label: "服务端脚本", content: <div className="min-w-0 space-y-4"><p className="text-xs leading-5 text-slate-500">用于支持 fetch 与 AbortSignal.timeout 的 Node.js。分别保存为 submit.mjs 和 read.mjs，与 request.json 放在同一目录；脚本各只发一次请求，不自动轮询或重发。</p>{code("首次提交脚本", guide.nodePost)}{code("只读查询脚本", guide.nodeGet)}</div> },
      ]} />
      <p className="text-xs leading-5 text-slate-600">POST 返回 202 只表示请求已登记，不表示完成；核对 ok、call.state、call.resultAvailable 与实际发布版本。失败、等待或未知不能当作成功成果；deliveryConfirmed 不表示已经对外交付。</p>
      <p className="text-xs leading-5 text-slate-600">停用工具、到期或撤销凭据后，调用与读取回执都可能被拒绝；已登记任务不会因此自动取消。当前未开放第三方浏览器跨站调用，不提供网页嵌入代码。</p>
    </> : null}
    {message ? <p role={message.error ? "alert" : "status"} className="rounded-lg bg-slate-50 p-3 text-sm leading-6">{message.text}</p> : null}
  </div>;
}
