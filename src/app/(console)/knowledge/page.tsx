import Link from "next/link";
import { KnowledgeList, UploadSourceForm } from "@/features/knowledge/KnowledgeList";
import { KnowledgeRefreshButton } from "@/features/knowledge/KnowledgeRefreshButton";
import { KnowledgeSearch } from "@/features/knowledge/KnowledgeSearch";
import { ToolCatalog } from "@/features/capabilities/ToolCatalog";
import { listKnowledgeSources, searchKnowledgeChunks } from "@/server/queries/knowledge";
import { firstSearchParam, pageFromSearchParam } from "@/lib/search-params";
import { withSafeQueryError } from "@/server/security/query-error";
import { listVisibleToolRegistry } from "@/server/queries/tool-registry";
import { PageHeader } from "@/components/ui/page-header";
import { SectionReadState } from "@/components/ui/SectionReadState";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

function pageHref(args: { search: string; source: string; page: number; archivedPage: number }) {
  const params = new URLSearchParams();
  if (args.search) params.set("q", args.search);
  if (args.source) params.set("source", args.source);
  if (args.page > 1) params.set("page", String(args.page));
  if (args.archivedPage > 1) params.set("archivedPage", String(args.archivedPage));
  const suffix = params.toString();
  return suffix ? `/knowledge?${suffix}` : "/knowledge";
}

function Pagination({ label, page, hasNext, previousHref, nextHref }: {
  label: string; page: number; hasNext: boolean; previousHref: string; nextHref: string;
}) {
  if (page === 1 && !hasNext) return null;
  return <nav aria-label={label} className="mt-4 flex items-center justify-end gap-3 text-sm">
    {page > 1 ? <Link href={previousHref} className="rounded border px-3 py-1.5">上一页</Link> : <span className="rounded border px-3 py-1.5 opacity-40">上一页</span>}
    <span>第 {page} 页</span>
    {hasNext ? <Link href={nextHref} className="rounded border px-3 py-1.5">下一页</Link> : <span className="rounded border px-3 py-1.5 opacity-40">下一页</span>}
  </nav>;
}

export default async function KnowledgePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = firstSearchParam(params.q)?.trim().slice(0, 200) ?? "";
  const sourceQuery = firstSearchParam(params.source)?.trim().slice(0, 200) ?? "";
  const page = pageFromSearchParam(params.page);
  const archivedPage = pageFromSearchParam(params.archivedPage);
  const [sourceRead, archivedRead, searchRead, toolsRead] = await Promise.allSettled([
    withSafeQueryError(() => listKnowledgeSources(false, { query: sourceQuery, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }), "knowledge-active"),
    withSafeQueryError(() => listKnowledgeSources(true, { query: sourceQuery, limit: PAGE_SIZE + 1, offset: (archivedPage - 1) * PAGE_SIZE }), "knowledge-archived"),
    withSafeQueryError(() => query ? searchKnowledgeChunks(query) : Promise.resolve(null), "knowledge-search"),
    withSafeQueryError(async () => listVisibleToolRegistry(), "knowledge-tools"),
  ]);
  const sources = sourceRead.status === "fulfilled" ? sourceRead.value.slice(0, PAGE_SIZE) : null;
  const archivedSources = archivedRead.status === "fulfilled" ? archivedRead.value.slice(0, PAGE_SIZE) : null;
  const searchResult = searchRead.status === "fulfilled" ? searchRead.value : null;
  const tools = toolsRead.status === "fulfilled" ? toolsRead.value : null;
  const hasNext = sourceRead.status === "fulfilled" && sourceRead.value.length > PAGE_SIZE;
  const archivedHasNext = archivedRead.status === "fulfilled" && archivedRead.value.length > PAGE_SIZE;
  const unread = [sources === null ? "在用资料" : null, archivedSources === null ? "已归档资料" : null, searchRead.status === "rejected" ? "检索结果" : null, tools === null ? "业务工具目录" : null].filter(Boolean);
  return (
    <main className="page-shell">
      <PageHeader eyebrow="业务资源" title="资料与应用" description="管理公司资料，查看已登记的业务工具，并找到模型连接入口。"
        action={<KnowledgeRefreshButton />} />
      {unread.length ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">部分内容暂时无法读取：{unread.join("、")}。已读取的其他内容仍可查看；下面保留对应核对入口，不把读取失败当作空记录。</p> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
        <span>资料是否可检索以解析状态为准；工具已登记不代表连接可用。</span>
        <Link href="/settings" className="font-semibold text-indigo-700 underline-offset-2 hover:underline">查看模型连接</Link>
      </div>
      <nav aria-label="资料与应用分类" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <a href="#business-tools" className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-900 transition hover:border-indigo-200 hover:bg-indigo-50/40">业务工具<span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{tools === null ? "登记目录暂不可读，数量尚无法核对" : `查看已登记的 ${tools.length} 项工具与风险级别`}</span></a>
        <a href="#knowledge-sources" className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-900 transition hover:border-indigo-200 hover:bg-indigo-50/40">公司资料<span className="mt-1 block text-xs font-normal leading-5 text-slate-500">上传、查找并核对解析状态</span></a>
        <Link href="/settings" className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-900 transition hover:border-indigo-200 hover:bg-indigo-50/40">模型连接<span className="mt-1 block text-xs font-normal leading-5 text-slate-500">在管理设置中核对和维护</span></Link>
        <Link href="/connections" className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-900 transition hover:border-indigo-200 hover:bg-indigo-50/40">外部工具连接<span className="mt-1 block text-xs font-normal leading-5 text-slate-500">区分已登记工具与尚未接通的协议连接</span></Link>
      </nav>
      {tools === null ? <SectionReadState id="business-tools" title="业务工具目录暂时无法读取" description="登记目录读取失败，不能判断工具数量、连接或授权是否可用。可继续管理已读取的资料；这里不会提供猜测的工具项。" /> : <ToolCatalog tools={tools} />}
      <UploadSourceForm />
      <KnowledgeSearch result={searchResult} query={query} sourceQuery={sourceQuery} page={page} archivedPage={archivedPage} unavailable={searchRead.status === "rejected"} />
      <form method="get" className="content-card flex flex-wrap items-end gap-3">
        {query ? <input type="hidden" name="q" value={query} /> : null}
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-gray-600">按文件名查找资料
          <input type="search" name="source" defaultValue={sourceQuery} maxLength={200} className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white">查找</button>
        {sourceQuery ? <Link href={pageHref({ search: query, source: "", page: 1, archivedPage: 1 })} className="px-1 py-2 text-sm text-gray-500 hover:text-gray-800">清除查找</Link> : null}
      </form>
      {sources === null ? <SectionReadState id="knowledge-sources" title="公司资料暂时无法读取" description="在用资料列表暂时无法核对。文件名和页码已保留；这不是未上传或没有匹配资料的结论。重新读取成功后再核对解析、归档与原文件状态。" /> : <section id="knowledge-sources" aria-labelledby="knowledge-sources-title" className="content-card scroll-mt-32">
        <div className="mb-4"><h2 id="knowledge-sources-title" className="section-title">公司资料</h2><p className="mt-1 text-sm text-slate-500">查看解析进度、下载原文件或归档不再使用的资料。</p></div>
        <KnowledgeList initial={sources} serverManaged hasFilter={Boolean(sourceQuery)}
          emptyPageHref={page > 1 ? pageHref({ search: query, source: sourceQuery, page: page - 1, archivedPage }) : undefined} />
        <Pagination label="在用资料分页" page={page} hasNext={hasNext}
          previousHref={pageHref({ search: query, source: sourceQuery, page: page - 1, archivedPage })}
          nextHref={pageHref({ search: query, source: sourceQuery, page: page + 1, archivedPage })} />
      </section>}
      {archivedSources === null ? <SectionReadState id="archived-knowledge-sources" title="已归档资料暂时无法读取" description="归档列表暂时无法核对，不能判断是否存在可恢复资料。在用资料和检索内容仍以各自已读取的记录为准。重新读取不会恢复或归档资料。" /> : archivedSources.length > 0 || archivedPage > 1 ? <section id="archived-knowledge-sources" aria-labelledby="archived-knowledge-sources-title" className="content-card scroll-mt-32">
        <h2 id="archived-knowledge-sources-title" className="mb-3 text-sm font-semibold text-gray-700">已归档资料</h2>
        <KnowledgeList initial={archivedSources} archived serverManaged hasFilter={Boolean(sourceQuery)}
          emptyPageHref={archivedPage > 1 ? pageHref({ search: query, source: sourceQuery, page, archivedPage: archivedPage - 1 }) : undefined} />
        <Pagination label="已归档资料分页" page={archivedPage} hasNext={archivedHasNext}
          previousHref={pageHref({ search: query, source: sourceQuery, page, archivedPage: archivedPage - 1 })}
          nextHref={pageHref({ search: query, source: sourceQuery, page, archivedPage: archivedPage + 1 })} />
      </section> : null}
    </main>
  );
}
