"use client";

import Link from "next/link";
import { CircleHelp, ArrowUpRight } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ReadOnlyDialog } from "@/components/ui/ReadOnlyDialog";

const helpLinks = [
  { href: "/agents", title: "找到需要使用的助手", detail: "进入助手工作台，核对已发布版本和本次需要填写的资料。" },
  { href: "/agents/new", title: "创建与完善助手", detail: "说明工作目标，完善流程、输入和交付；试运行、验收与发布分别核对。" },
  { href: "/knowledge", title: "准备公司资料", detail: "上传资料后核对解析状态，再为助手选择需要读取的范围。" },
  { href: "/settings", title: "配置模型连接", detail: "保存后可测试连接；连接测试成功不代表整条流程或业务验收通过。" },
  { href: "/runs", title: "查看结果与反馈", detail: "打开任务详情，核对实际状态、处理步骤、交付内容和确认记录。" },
  { href: "/#system-health", title: "检查运行服务", detail: "前往工作台查看当前检查结果，也可手动重新检查；不在这里推测服务状态。" },
] as const;

export function UsageHelpDialog() {
  const helpId = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return <>
    <button ref={triggerRef} type="button" aria-label="打开使用帮助" aria-haspopup="dialog" aria-expanded={open}
      title="使用帮助" onClick={() => setOpen(true)}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
      <CircleHelp aria-hidden="true" className="size-4" /><span>帮助</span>
    </button>
    <ReadOnlyDialog open={open} onOpenChange={setOpen} title="使用帮助"
      description="先找到合适的助手，再填写业务资料，最后核对实际结果。这里只提供使用指引，不会保存设置、启动或取消任务。"
      closeLabel="关闭使用帮助" returnFocusRef={triggerRef}>
      <section aria-label="日常使用步骤" className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
        <h3 className="text-sm font-semibold text-slate-950">选择助手 → 填写资料 → 查看结果</h3>
        <ol className="mt-3 grid gap-3 text-xs leading-5 text-slate-600 md:grid-cols-3">
          <li><span className="block font-semibold text-indigo-800">1. 先核对版本</span>选择需要使用的助手，在工作台核对正式版本与业务要求。</li>
          <li><span className="block font-semibold text-indigo-800">2. 再填写资料</span>按表单准备输入；表格导入先预览并确认应用，不会自动提交任务。</li>
          <li><span className="block font-semibold text-indigo-800">3. 最后核对结果</span>创建记录不等于完成。需要人工确认或补充资料时，在任务详情继续处理。</li>
        </ol>
      </section>
      <nav aria-label="使用帮助入口" className="mt-4 grid gap-3 md:grid-cols-2">
        {helpLinks.map((item, index) => <Link key={item.href} href={item.href} aria-label={item.title} aria-describedby={`${helpId}-${index}`} prefetch={false} onNavigate={() => setOpen(false)}
          className="group rounded-xl border border-slate-200 p-4 transition hover:border-indigo-200 hover:bg-indigo-50/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
          <span className="flex items-start justify-between gap-3 text-sm font-semibold text-slate-950">{item.title}<ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-slate-400 group-hover:text-indigo-600" /></span>
          <span id={`${helpId}-${index}`} className="mt-2 block text-xs leading-5 text-slate-600">{item.detail}</span>
        </Link>)}
      </nav>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/connections" prefetch={false} onNavigate={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">核对外部工具</Link>
        <Link href="/runs/attention" prefetch={false} onNavigate={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">查看待处理任务</Link>
      </div>
      <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">资料解析、工具登记、连接测试与运行完成是不同的状态，请分别查看真实记录。任务结果暂时无法确认时，先查看或核对原任务，不要反复创建新请求。</p>
    </ReadOnlyDialog>
  </>;
}
