import { CircleAlert } from "lucide-react";

export function RunSectionUnavailable({ title, message }: { title: string; message: string }) {
  return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><h3 className="flex items-center gap-2 font-semibold"><CircleAlert aria-hidden className="size-4 shrink-0" />{title}</h3><p className="mt-1">{message}</p><p className="mt-2 text-xs text-amber-900">可使用页面上方的“重新读取状态”核对；读取不会修改这次任务或提交决定。</p></div>;
}
