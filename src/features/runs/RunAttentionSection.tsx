import Link from "next/link";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import type { RunSummary } from "@/contracts/run";
import { SectionReadState } from "@/components/ui/SectionReadState";
import { MAX_PAGE_NUMBER } from "@/lib/search-params";
import { RunList } from "./RunList";
import { attentionHref, type AttentionListState, type AttentionPageKey } from "./run-attention-url";

export const ATTENTION_PAGE_SIZE = 10;

export function RunAttentionSection({ id, title, description, emptyTitle, pageKey, state, result }: {
  id: string;
  title: string;
  description: string;
  emptyTitle: string;
  pageKey: AttentionPageKey;
  state: AttentionListState;
  result: PromiseSettledResult<RunSummary[]>;
}) {
  if (result.status === "rejected") return <SectionReadState id={id} title={`${title}暂时无法读取`} description="这一类任务的记录尚未核对，不能判断是否为空。可重新读取；其他分类不受影响。" />;
  const page = state[pageKey];
  const runs = result.value.slice(0, ATTENTION_PAGE_SIZE);
  const hasNext = result.value.length > ATTENTION_PAGE_SIZE && page < MAX_PAGE_NUMBER;
  const pageHref = (next: number) => `${attentionHref({ ...state, [pageKey]: next })}#${id}`;
  return <section id={id} aria-labelledby={`${id}-title`} className="content-card scroll-mt-24 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 max-w-2xl"><h2 id={`${id}-title`} className="section-title">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{description}</p></div>
      <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">本页 {runs.length} 条{hasNext ? "，还有更多" : ""}</span>
    </div>
    {runs.length ? <RunList runs={runs} returnHref={attentionHref(state)} /> : <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-7 text-center">
      <ClipboardCheck aria-hidden="true" className="size-6 text-slate-400" />
      <h3 className="mt-3 text-sm font-semibold text-slate-900">{page > 1 ? "当前页没有记录" : emptyTitle}</h3>
      <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{page > 1 ? "状态可能已有变化。可以保留范围及其他分类页码，回到这一类的第一页核对。" : "仅表示当前筛选范围的这一类暂无记录，不代表其他分类或其他助手没有待处理事项。"}</p>
      {page > 1 ? <Link href={pageHref(1)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-700 hover:text-indigo-900">回到这一类的第一页<ArrowRight aria-hidden="true" className="size-4" /></Link> : null}
    </div>}
    {page > 1 || hasNext ? <nav aria-label={`${title}翻页`} className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
      {page > 1 ? <Link href={pageHref(page - 1)} className="rounded-xl border border-slate-200 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">上一页</Link> : <span />}
      <span className="text-xs text-slate-500">第 {page} 页</span>
      {hasNext ? <Link href={pageHref(page + 1)} className="rounded-xl border border-slate-200 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">下一页</Link> : <span />}
    </nav> : null}
  </section>;
}
