import { CircleAlert } from "lucide-react";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";

export function SectionReadState({ id, title, description }: { id: string; title: string; description: string }) {
  return <section id={id} aria-labelledby={`${id}-read-title`} className="content-card scroll-mt-32 border-amber-200">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2"><CircleAlert aria-hidden="true" className="size-5 shrink-0 text-amber-600" /><h2 id={`${id}-read-title`} className="section-title">{title}</h2></div>
      <PageRefreshButton />
    </div>
    <p role="alert" className="mt-3 text-sm leading-6 text-amber-950">{description}</p>
    <p className="mt-2 text-xs leading-5 text-slate-500">这里只暂停受影响的操作，其他已读取内容仍可使用。重新读取不会提交业务修改。</p>
  </section>;
}
