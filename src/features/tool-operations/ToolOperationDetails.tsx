import type { ToolOperationView } from "@/contracts/tool-operation";
import { operationDate, operationReceiptText, operationStatusLabels, operationText } from "./tool-operation-presentation";

export function ToolOperationDetails({ operation }: { operation: ToolOperationView }) {
  return <section aria-label="核对详情" className="space-y-4">
    <div className="border-b border-slate-200 pb-4">
      <h2 className="text-lg font-bold text-slate-950">{operationText(operation.nodeTitle, operation) || "业务步骤"}</h2>
      <p className="mt-2 text-sm font-semibold text-indigo-700">{operationStatusLabels[operation.status]}</p>
      <dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
        <div><dt>首次记录</dt><dd className="mt-1">{operationDate(operation.createdAt)}</dd></div>
        <div><dt>最近更新</dt><dd className="mt-1">{operationDate(operation.updatedAt)}</dd></div>
        <div className="sm:col-span-2"><dt>允许重新尝试的期限</dt><dd className="mt-1">{operationDate(operation.retryDeadline)}</dd></div>
      </dl>
      {operation.error ? <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{operationText(operation.error, operation)}</p> : null}
    </div>
    <p className="text-xs leading-5 text-slate-500">当前接口未提供原始提交参数。请在业务系统核对实际记录；尚未确认完成不代表确定未执行。敏感内容与内部标识在只读展示中已隐藏。</p>
    {operation.receipt !== null ? <details open className="rounded-xl border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-semibold">已保存业务回执（只读）</summary>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs leading-5">{operationReceiptText(operation)}</pre>
    </details> : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">尚无已保存的业务回执。</p>}
    <section aria-label="核对历史">
      <h3 className="text-sm font-bold text-slate-900">核对历史</h3>
      {operation.resolutions.length ? <ol className="mt-3 space-y-3">{operation.resolutions.map((record, index) => <li key={record.requestId} className="rounded-xl border border-slate-200 p-3 text-sm">
        <p className="font-semibold">第{index + 1}次核对 · {record.kind === "retry" ? "确认未执行，允许之后重新尝试" : "确认已完成，记录实际回执"}</p>
        <time className="mt-1 block text-xs text-slate-500" dateTime={record.createdAt}>{operationDate(record.createdAt)}</time>
        <p className="mt-2 whitespace-pre-wrap break-words text-slate-600">{operationText(record.reason, operation)}</p>
      </li>)}</ol> : <p className="mt-2 text-sm text-slate-500">尚无人工核对记录。</p>}
    </section>
  </section>;
}
