import Link from "next/link";
import { MemoryList, MemoryPagination } from "@/features/memory/MemoryList";
import { ImprovementFeedbackList } from "@/features/memory/ImprovementFeedbackList";
import { listMemories, listMemoryAgentOptions } from "@/server/queries/memory";
import { listImprovementFeedback } from "@/server/queries/run-feedback";
import { firstSearchParam, pageFromSearchParam } from "@/lib/search-params";
import { withSafeQueryError } from "@/server/security/query-error";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { SectionReadState } from "@/components/ui/SectionReadState";
import { MemoryAgentOption } from "@/contracts/memory";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function pageHref(args: { agentId?: string; query?: string; feedbackPage: number; page: number; archivedPage: number }) {
  const params = new URLSearchParams();
  if (args.agentId) params.set("agent", args.agentId);
  if (args.query) params.set("q", args.query);
  if (args.feedbackPage > 1) params.set("feedbackPage", String(args.feedbackPage));
  if (args.page > 1) params.set("page", String(args.page));
  if (args.archivedPage > 1) params.set("archivedPage", String(args.archivedPage));
  const query = params.toString();
  return query ? `/memory?${query}` : "/memory";
}

export default async function MemoryPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawAgent = firstSearchParam(params.agent);
  const parsedAgent = rawAgent ? MemoryAgentOption.shape.id.safeParse(rawAgent) : null;
  const repeated = [params.agent, params.q, params.page, params.archivedPage, params.feedbackPage].some((value) => Array.isArray(value));
  if (repeated || (parsedAgent && !parsedAgent.success)) return <main className="page-shell">
    <PageHeader eyebrow="持续改进" title="成长中心" description="集中处理需要改进的运行结果，并管理助手明确保存的长期经验。" />
    <section aria-labelledby="memory-filter-error" className="content-card border-amber-200">
      <h2 id="memory-filter-error" className="section-title">成长中心筛选条件暂不可用</h2>
      <p role="alert" className="mt-3 text-sm leading-6 text-amber-950">助手范围无效，或筛选条件与页码重复。尚未读取经验或改进结果，不会自动扩大为全部助手。</p>
      <Link prefetch={false} href="/memory" className="mt-3 inline-block text-sm font-semibold text-indigo-700">清除无效筛选</Link>
    </section>
  </main>;
  const agentId = parsedAgent?.success ? parsedAgent.data.toLowerCase() : undefined;
  const query = firstSearchParam(params.q)?.trim().slice(0, 200);
  const feedbackPage = pageFromSearchParam(params.feedbackPage);
  const page = pageFromSearchParam(params.page);
  const archivedPage = pageFromSearchParam(params.archivedPage);
  const [memoryRead, archivedRead, agentsRead, feedbackRead] = await Promise.allSettled([
    withSafeQueryError(() => listMemories({ agentId, query, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }), "memory-active"),
    withSafeQueryError(() => listMemories({ agentId, query, archived: true, limit: PAGE_SIZE + 1, offset: (archivedPage - 1) * PAGE_SIZE }), "memory-archived"),
    withSafeQueryError(() => listMemoryAgentOptions(), "memory-agent-options"),
    withSafeQueryError(() => listImprovementFeedback({ agentId, query, limit: PAGE_SIZE + 1, offset: (feedbackPage - 1) * PAGE_SIZE }), "memory-improvement-feedback"),
  ]);
  const improvementFeedback = feedbackRead.status === "fulfilled" ? feedbackRead.value.slice(0, PAGE_SIZE) : null;
  const memories = memoryRead.status === "fulfilled" ? memoryRead.value.slice(0, PAGE_SIZE) : null;
  const archivedMemories = archivedRead.status === "fulfilled" ? archivedRead.value.slice(0, PAGE_SIZE) : null;
  const agents = agentsRead.status === "fulfilled" ? agentsRead.value : null;
  const hasNext = memoryRead.status === "fulfilled" && memoryRead.value.length > PAGE_SIZE;
  const archivedHasNext = archivedRead.status === "fulfilled" && archivedRead.value.length > PAGE_SIZE;
  const feedbackHasNext = feedbackRead.status === "fulfilled" && feedbackRead.value.length > PAGE_SIZE;
  const unread = [memories === null ? "在用经验" : null, archivedMemories === null ? "已停用经验" : null, agents === null ? "助手名单" : null, improvementFeedback === null ? "待改进结果" : null].filter(Boolean);
  const selectedOptionKnown = agentId && agents?.some((agent) => agent.id.toLowerCase() === agentId);
  const filtered = Boolean(agentId || query);
  return <main className="page-shell">
    <PageHeader eyebrow="持续改进" title="成长中心" description="集中处理需要改进的运行结果，并管理助手明确保存的长期经验。" action={<PageRefreshButton />} />
    {unread.length ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">部分内容暂时无法读取：{unread.join("、")}。已读取的其他内容仍可使用；未读到的数量未知，不当成空记录。</p> : null}
    <p className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-950">长期经验由流程中的“保存经验”步骤产生，只供原助手在后续运行中检索。停用后不再参与检索，来源运行记录仍可查看。</p>
    <form method="get" className="content-card flex flex-wrap items-end gap-3">
      <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-gray-600">助手
        <select name="agent" aria-label="助手" defaultValue={agentId ?? ""} disabled={agents === null} className="rounded-md border border-gray-300 px-2 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500">
          <option value="">全部助手</option>
          {agentId && !selectedOptionKnown ? <option value={agentId}>所选助手（名称暂不可核对）</option> : null}
          {agents?.map((agent) => <option key={agent.id} value={agent.id.toLowerCase()}>{agent.name}</option>)}
        </select>
        {agents === null && agentId ? <input type="hidden" name="agent" value={agentId} /> : null}
        {agents === null ? <span className="text-xs leading-5 text-amber-800">助手名单暂不可读，暂不更换助手范围；内容查找仍保留当前范围。</span> : null}
      </label>
      <label className="flex min-w-56 flex-[2] flex-col gap-1 text-xs text-gray-600">内容关键词
        <input name="q" defaultValue={query ?? ""} maxLength={200} className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
      </label>
      <button type="submit" className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white">筛选</button>
      {filtered ? <Link href="/memory" className="px-1 py-2 text-sm text-gray-500 hover:text-gray-800">清除筛选</Link> : null}
    </form>
    {improvementFeedback === null ? <SectionReadState id="memory-feedback" title="待改进结果暂时无法读取" description="当前助手和内容筛选仍保留。未读到反馈不等于没有需要改进的结果，当前不提供猜测的加入验收操作。" /> : <section aria-labelledby="memory-feedback-title" className="content-card flex flex-col gap-3">
      <div>
        <h2 id="memory-feedback-title" className="text-lg font-semibold">待改进结果</h2>
        <p className="mt-1 text-xs text-gray-500">需要改进的运行反馈；加入验收后可继续补充期望结果。</p>
      </div>
      {improvementFeedback.length === 0 && feedbackPage > 1 ? <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">当前页没有读到待改进结果，不能据此判断整个筛选范围为空。可返回上一页核对。</p> : <ImprovementFeedbackList feedback={improvementFeedback} />}
      <MemoryPagination
        page={feedbackPage}
        hasNext={feedbackHasNext}
        previousHref={pageHref({ agentId, query, feedbackPage: feedbackPage - 1, page, archivedPage })}
        nextHref={pageHref({ agentId, query, feedbackPage: feedbackPage + 1, page, archivedPage })}
        label="待改进结果翻页"
      />
    </section>}
    {memories === null ? <SectionReadState id="memory-active" title="长期经验暂时无法读取" description="当前助手、内容关键词和页码仍保留。未读到在用经验不代表没有经验，也不能决定是否停用；已读取的反馈和停用记录仍可核对。" /> : <section aria-labelledby="memory-active-title" className="content-card flex flex-col gap-3">
      <div><h2 id="memory-active-title" className="text-lg font-semibold">长期经验</h2><p className="mt-1 text-xs text-slate-500">先阅读摘要；展开可查看完整保存内容，再决定是否停用。</p></div>
    {memories.length === 0 && page > 1 ? <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">当前页没有读到在用经验，不能据此判断整个筛选范围为空。可返回上一页核对。</p> : <MemoryList memories={memories} filtered={filtered} />}
    <MemoryPagination
      page={page}
      hasNext={hasNext}
      previousHref={pageHref({ agentId, query, feedbackPage, page: page - 1, archivedPage })}
      nextHref={pageHref({ agentId, query, feedbackPage, page: page + 1, archivedPage })}
      label="在用经验翻页"
    />
    </section>}
    {archivedMemories === null ? <SectionReadState id="memory-archived" title="已停用经验暂时无法读取" description="无法核对停用记录和可恢复经验，不把读取失败当成没有记录。当前助手和页码仍保留，重新读取不会恢复或停用经验。" /> : archivedMemories.length > 0 || archivedPage > 1 ? <section aria-labelledby="memory-archived-title" className="content-card">
      <h2 id="memory-archived-title" className="mb-3 text-sm font-semibold text-gray-700">已停用经验</h2>
      {archivedMemories.length === 0 && archivedPage > 1 ? <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">当前页没有读到已停用经验，不能据此判断没有停用记录。可返回上一页核对。</p> : <MemoryList memories={archivedMemories} archived filtered={filtered} />}
      <div className="mt-4">
        <MemoryPagination
          page={archivedPage}
          hasNext={archivedHasNext}
          previousHref={pageHref({ agentId, query, feedbackPage, page, archivedPage: archivedPage - 1 })}
          nextHref={pageHref({ agentId, query, feedbackPage, page, archivedPage: archivedPage + 1 })}
          label="已停用经验翻页"
        />
      </div>
    </section> : null}
  </main>;
}
