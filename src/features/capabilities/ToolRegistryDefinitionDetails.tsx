"use client";

import { useState } from "react";
import type { ToolRegistryOption } from "@/contracts/tool-registry";

const typeLabels: Record<string, string> = { string: "文字", number: "数字", integer: "整数", boolean: "是非值", object: "对象", array: "列表", null: "空值" };

function schemaType(value: unknown): string {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) return "未直接声明类型";
  return values.map((type) => typeof type === "string" && Object.hasOwn(typeLabels, type) ? typeLabels[type] : "未直接声明类型").join("、");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function SchemaSummary({ title, schema }: { title: string; schema: ToolRegistryOption["inputSchema"] }) {
  const fields = isRecord(schema.properties) ? Object.entries(schema.properties) : [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : []);
  const undescribedRequired = [...required].filter((name) => !fields.some(([key]) => key === name)).length;
  return <section aria-label={title} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
    <h4 className="font-semibold text-slate-900">{title}</h4>
    <p className="mt-1 text-xs text-slate-600">根结构：{schemaType(schema.type)} · 直接登记字段 {fields.length} 项</p>
    {fields.length ? <ul className="mt-3 space-y-2">
      {fields.slice(0, 12).map(([key, value], index) => <li key={key} className="min-w-0 border-t border-slate-100 pt-2">
        <div className="flex flex-wrap justify-between gap-2"><span className="break-words font-medium text-slate-800">{isRecord(value) && typeof value.title === "string" && value.title.trim() ? value.title : "第" + (index + 1) + "项字段"}</span><span className="text-xs text-slate-500">{required.has(key) ? "明确要求提供" : "未直接声明必需"}</span></div>
        <p className="mt-1 text-xs text-slate-500">{isRecord(value) ? schemaType(value.type) : "另有规则，需核对原定义"}</p>
        {isRecord(value) && typeof value.description === "string" && value.description ? <p className="mt-1 break-words text-xs leading-5 text-slate-600">{value.description}</p> : null}
        {isRecord(value) && Array.isArray(value.enum) ? <p className="mt-1 text-xs text-slate-500">登记了 {value.enum.length} 个限定值；具体内容见开发者原定义。</p> : null}
      </li>)}
    </ul> : <p className="mt-2 text-xs text-slate-500">未单独列出直接字段，不代表没有输入限制或会生成空结果。</p>}
    {fields.length > 12 ? <p className="mt-3 text-xs text-slate-500">仅展开前12项字段；其余 {fields.length - 12} 项及嵌套规则保留在原定义中。</p> : null}
    {undescribedRequired > 0 ? <p className="mt-2 text-xs text-amber-800">有 {undescribedRequired} 项必需字段未提供独立字段说明，请核对原定义。</p> : null}
    <p className="mt-2 text-xs text-slate-500">额外字段声明：{schema.additionalProperties === false ? "明确不接收" : schema.additionalProperties === true ? "明确允许" : isRecord(schema.additionalProperties) ? "另有字段规则" : "未单独登记"}</p>
  </section>;
}

function retentionLabel(value: number): string {
  if (value % 86_400_000 === 0) return value / 86_400_000 + "天";
  if (value % 3_600_000 === 0) return value / 3_600_000 + "小时";
  if (value % 60_000 === 0) return value / 60_000 + "分钟";
  if (value % 1_000 === 0) return value / 1_000 + "秒";
  return value + "毫秒";
}

export function ToolRegistryDefinitionDetails({ tool }: { tool: ToolRegistryOption }) {
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const protocol = tool.protocol === "mcp-streamable-http" ? "远端工具协议"
    : tool.protocol === "http-json" ? "业务接口的结构化数据交换" : "未单独登记连接方式";
  const operation = tool.operationKind === "read" ? "已声明为读取"
    : tool.operationKind === "action" ? "已声明可能改变外部业务数据" : "未登记读写分类，不能按风险或名称推测";
  const duplicatePolicy = tool.businessIdempotency === true ? "已声明支持按业务键核对重复请求"
    : tool.businessIdempotency === false ? "已明确未声明按业务键核对重复请求" : "未提供业务重复请求声明";
  const original = technicalOpen ? JSON.stringify(tool, null, 2) : "";
  return <section aria-label={tool.name + "的完整登记定义"} className="space-y-3 border-t border-slate-200 pt-3">
    <h4 className="font-semibold text-slate-900">已登记的执行约定</h4>
    <dl className="grid gap-3 sm:grid-cols-2">
      <div><dt className="font-medium text-slate-900">连接方式</dt><dd>{protocol}</dd></div>
      <div><dt className="font-medium text-slate-900">业务影响</dt><dd>{operation}</dd></div>
      <div><dt className="font-medium text-slate-900">重复请求核对</dt><dd>{duplicatePolicy}</dd></div>
      <div><dt className="font-medium text-slate-900">登记的保留时长</dt><dd>{tool.businessIdempotencyRetentionMs === undefined ? "未提供时长声明" : retentionLabel(tool.businessIdempotencyRetentionMs)}</dd></div>
    </dl>
    <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-900">这里展示管理员的声明，不证明已获授权、调用成功或可以安全重发。业务键仍需在实际流程中明确配置；保留时长不是所有运行记录的保存期限。</p>
    <div className="grid gap-3 xl:grid-cols-2"><SchemaSummary title="输入字段约定" schema={tool.inputSchema} /><SchemaSummary title="结果字段约定" schema={tool.outputSchema} /></div>
    <p className="text-xs leading-5 text-slate-500">字段概览只列直接登记内容，不推测嵌套、组合条件或实际业务值。结构化业务接口与远端工具可能校验不同层级的输入，最终以当前定义及真实运行校验为准。</p>
    <p className="text-xs leading-5 text-slate-500">这里核对服务端本次返回的生效定义，可能包含服务端默认值；不是原始登记配置，也不证明管理员逐项填写了这些规则。</p>
    <details open={technicalOpen} onToggle={(event) => setTechnicalOpen(event.currentTarget.open)} className="rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-500">开发者完整登记原定义（只读）</summary>
      {technicalOpen ? <div className="border-t border-slate-200 p-3"><p className="mb-2 text-xs leading-5 text-slate-500">动作、范围、内部标识及完整字段规则仅供维护人员核对；不包含连接地址和凭据，不会修改登记或发起调用。</p><textarea aria-label={tool.name + "的登记原定义"} value={original} readOnly rows={12} spellCheck={false} className="w-full min-w-0 resize-y rounded border border-slate-200 bg-slate-50 p-2 font-mono text-xs" /></div> : null}
    </details>
  </section>;
}
