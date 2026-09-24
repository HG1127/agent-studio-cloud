import { KnowledgeList, UploadSourceForm } from "@/features/knowledge/KnowledgeList";
import { KnowledgeSearch } from "@/features/knowledge/KnowledgeSearch";
import { listKnowledgeSources, searchKnowledgeChunks } from "@/server/queries/knowledge";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positivePage(value: string | undefined) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 1;
}

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
  const query = one(params.q)?.trim().slice(0, 200) ?? "";
  const sourceQuery = one(params.source)?.trim().slice(0, 200) ?? "";
  const page = positivePage(one(params.page));
  const archivedPage = positivePage(one(params.archivedPage));
  const [sourceRows, archivedRows, searchResult] = await Promise.all([
    listKnowledgeSources(false, { query: sourceQuery, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    listKnowledgeSources(true, { query: sourceQuery, limit: PAGE_SIZE + 1, offset: (archivedPage - 1) * PAGE_SIZE }),
    query ? searchKnowledgeChunks(query) : null,
  ]);
  const sources = sourceRows.slice(0, PAGE_SIZE);
  const archivedSources = archivedRows.slice(0, PAGE_SIZE);
  const hasNext = sourceRows.length > PAGE_SIZE;
  const archivedHasNext = archivedRows.length > PAGE_SIZE;
  return (
    <main className="mx-auto w-full max-w-3xl px-8 py-8">
      <h1 className="text-xl font-semibold text-gray-900">知识库</h1>
      <p className="mt-1 text-sm text-gray-600">上传业务资料，运行时会按关键词检索相关内容给助手参考。</p>
      <div className="mt-6"><UploadSourceForm /></div>
      <KnowledgeSearch result={searchResult} />
      <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        {query ? <input type="hidden" name="q" value={query} /> : null}
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-gray-600">按文件名查找资料
          <input type="search" name="source" defaultValue={sourceQuery} maxLength={200} className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white">查找</button>
        {sourceQuery ? <Link href={pageHref({ search: query, source: "", page: 1, archivedPage: 1 })} className="px-1 py-2 text-sm text-gray-500 hover:text-gray-800">清除查找</Link> : null}
      </form>
      <div className="mt-6">
        <KnowledgeList initial={sources} serverManaged />
        <Pagination label="在用资料分页" page={page} hasNext={hasNext}
          previousHref={pageHref({ search: query, source: sourceQuery, page: page - 1, archivedPage })}
          nextHref={pageHref({ search: query, source: sourceQuery, page: page + 1, archivedPage })} />
      </div>
      {archivedSources.length > 0 || archivedPage > 1 ? <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">已归档资料</h2>
        <KnowledgeList initial={archivedSources} archived serverManaged />
        <Pagination label="已归档资料分页" page={archivedPage} hasNext={archivedHasNext}
          previousHref={pageHref({ search: query, source: sourceQuery, page, archivedPage: archivedPage - 1 })}
          nextHref={pageHref({ search: query, source: sourceQuery, page, archivedPage: archivedPage + 1 })} />
      </section> : null}
    </main>
  );
}
import Link from "next/link";
