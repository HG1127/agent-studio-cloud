import type { ReactNode } from "react";
import { CircleCheck, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";

export function CapabilityNotice({ mode, title, children, className }: {
  mode: "connected" | "draft";
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const draft = mode === "draft";
  const Icon = draft ? NotebookPen : CircleCheck;
  return <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3",
    draft ? "border-amber-200/80 bg-amber-50/70 text-amber-950" : "border-emerald-200/80 bg-emerald-50/60 text-emerald-950", className)}>
    <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    <div className="min-w-0">
      <p className="text-sm font-semibold">{title ?? (draft ? "仅本页草稿，尚未保存" : "已接入现有接口")}</p>
      <div className="mt-1 text-xs leading-5">{children ?? (draft
        ? "可以填写、检查并预览设计。保存接口尚未接入，这些填写不会改变系统配置；离开页面前请核对未保存内容。"
        : "本区域使用系统已有能力，读取或提交的实际状态以系统返回为准。")}</div>
    </div>
  </div>;
}
