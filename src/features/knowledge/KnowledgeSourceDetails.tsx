"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { ArrowRight, Download, FileText, X } from "lucide-react";
import type { KnowledgeSourceView } from "@/contracts/knowledge";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";

const STATUS_LABELS = { parsing: "解析中", indexed: "已就绪", failed: "解析失败", archived: "已归档" } as const;
const FILE_TYPES: Record<string, string> = {
  "application/pdf": "便携文档", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "文字文档",
  "text/plain": "纯文本", "text/markdown": "标记文本", "text/html": "网页文档", "application/json": "结构化数据",
  "text/csv": "表格数据", "application/xml": "标记数据", "text/xml": "标记数据",
};

function count(value: number, unit: string) {
  return Number.isSafeInteger(value) && value >= 0 ? `${value.toLocaleString("zh-CN")} ${unit}` : "暂未核对";
}

function uploadedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间暂不可读" : new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(date);
}

export function KnowledgeSourceDetails({ source }: { source: KnowledgeSourceView }) {
  const status = source.parsingStalled ? "解析已中断" : STATUS_LABELS[source.status];
  const fileSize = Number.isFinite(source.sizeBytes) && source.sizeBytes >= 0 ? `${(source.sizeBytes / 1024).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} 千字节` : "暂未核对";
  return <Dialog.Root>
    <Dialog.Trigger asChild><button type="button" className="font-medium text-indigo-700 hover:underline">查看资料</button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px]" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[calc(100%-4rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none">
        <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><FileText aria-hidden="true" className="size-5" /></span>
          <div className="min-w-0 flex-1"><Dialog.Title className="text-base font-bold text-slate-950">资料记录详情</Dialog.Title><Dialog.Description className="mt-1 text-xs leading-5 text-slate-500">核对当前页面读取的资料与解析记录，不是全文预览，也不证明某位助手已经使用这份资料。</Dialog.Description></div>
          <Dialog.Close aria-label="关闭资料详情" className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X aria-hidden="true" className="size-4" /></Dialog.Close>
        </div>
        <div className="min-h-0 overflow-y-auto p-5">
          <p className="break-words text-base font-semibold text-slate-950">{source.name}</p>
          <dl aria-label="资料解析记录" className="mt-4 grid grid-cols-2 gap-3">
            {[['当前状态', status], ['文件类型', FILE_TYPES[source.mime.toLowerCase()] ?? "未识别类型"], ['文件大小', fileSize], ['已记录的内容段数', count(source.chunkCount, "段")], ['已记录的字符数', count(source.charCount, "个字符")], ['原文件保留', source.hasOriginal === true ? "已记录原文件" : source.hasOriginal === false ? "未保留原文件" : "暂未核对"]].map(([label, value]) => <div key={label} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</dd></div>)}
            <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3"><dt className="text-xs text-slate-500">上传时间（北京时间）</dt><dd className="mt-1 text-sm font-semibold text-slate-800">{uploadedAt(source.createdAt)}</dd></div>
          </dl>
          <p className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs leading-6 text-indigo-950">{source.status === "archived" ? "已归档资料不参与助手后续检索。恢复后仍需核对解析状态与助手所选资料范围。" : source.status === "indexed" ? "这份资料已就绪；助手仍只检索发布版本中选定的资料，不代表所有助手都可引用。" : source.status === "failed" || source.parsingStalled ? source.hasOriginal === true ? "解析尚未就绪，可关闭详情后在列表中重新解析。" : source.hasOriginal === false ? "解析尚未就绪且未保留原文件，需要重新上传同一文件。" : "解析尚未就绪，原文件是否保留尚未核对，请重新读取状态后确定恢复方式。" : "解析尚未完成，当前段数与字符数可能继续变化；请使用页面上的重新读取状态核对，不会自动重复查询。"}</p>
          {source.error ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-950">已保存的解析说明</p><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-amber-900">{source.error}</p></div> : null}
          <p className="mt-3 text-xs leading-5 text-slate-500">段数和字符数是当前记录的解析统计，不是文档页数、业务完整性或检索质量结论。原文件有保留记录也不保证本次下载一定成功。</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-5">
          <div className="flex flex-wrap items-center gap-3">{source.hasOriginal === true ? <a href={`/api/knowledge/sources/${source.id}/file`} download className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-700 hover:underline"><Download aria-hidden="true" className="size-4" />下载原文件</a> : null}<Link href="/agents" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-950">核对助手资料范围<ArrowRight aria-hidden="true" className="size-4" /></Link></div>
          <div className="flex items-center gap-2"><PageRefreshButton /><Dialog.Close className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">关闭详情</Dialog.Close></div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
