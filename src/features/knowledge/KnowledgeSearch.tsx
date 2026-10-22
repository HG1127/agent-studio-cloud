import Link from "next/link";
import type { KnowledgeSearchResult } from "@/contracts/knowledge";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";

export function KnowledgeSearch({ result, query, sourceQuery = "", page = 1, archivedPage = 1, unavailable = false }: { result: KnowledgeSearchResult | null; query?: string; sourceQuery?: string; page?: number; archivedPage?: number; unavailable?: boolean }) {
  return (
    <section id="knowledge-search" aria-labelledby="knowledge-search-title" className="content-card scroll-mt-32">
      <div>
        <h2 id="knowledge-search-title" className="text-sm font-semibold">验证资料检索</h2>
        <p className="mt-1 text-xs text-gray-500">输入业务关键词，检查当前资料库中哪些已就绪内容可以找到。</p>
      </div>
      <form method="get" className="mt-3 flex flex-wrap gap-2">
        {sourceQuery ? <input type="hidden" name="source" value={sourceQuery} /> : null}
        {page > 1 ? <input type="hidden" name="page" value={page} /> : null}
        {archivedPage > 1 ? <input type="hidden" name="archivedPage" value={archivedPage} /> : null}
        <input name="q" aria-label="检索关键词" defaultValue={query ?? result?.query ?? ""} maxLength={200} required
          placeholder="例如：退货期限" className="min-w-56 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700">开始检索</button>
      </form>
      <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2.5 text-xs leading-5 text-amber-900">
        <p>这里检查的是当前资料库，不等于某位助手的运行结果。助手只使用发布版本选定的资料，检索词也可能不同。</p>
        <Link href="/agents" className="mt-1 inline-block font-semibold text-amber-950 underline-offset-2 hover:underline">前往助手核对资料范围</Link>
      </div>
      {unavailable ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p role="alert" className="text-sm font-semibold text-amber-950">检索结果暂时无法读取</p><p className="mt-2 text-xs leading-6 text-amber-900">已保留本次关键词；不能据此判断没有匹配内容。重新读取不会上传、归档资料或运行助手。</p><div className="mt-3"><PageRefreshButton /></div></div> : result ? (
        <div className="mt-4">
          <p role="status" className="text-sm text-gray-600">
            {result.hits.length > 0
              ? `本次展示 ${result.hits.length} 段相关内容`
              : result.truncated
                ? "本次检查的资料中没有找到相关内容，尚有其他资料未检查。"
                : "当前资料库没有找到相关内容，请换个关键词或检查资料解析状态。"}
          </p>
          {result.truncated ? <p className="mt-1 text-xs text-amber-700">资料较多，本次只检查最近入库的 2000 段内容。</p> : null}
          {result.hits.length > 0 ? <ol className="mt-3 space-y-3">
            {result.hits.map((hit) => (
              <li key={`${hit.sourceId}-${hit.chunkIndex}`} className="rounded-md border border-gray-100 bg-gray-50 p-3">
                <p className="text-sm font-medium text-gray-800">{hit.sourceName} · 第 {hit.chunkIndex + 1} 段</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-600">{hit.excerpt}</p>
              </li>
            ))}
          </ol> : null}
        </div>
      ) : null}
    </section>
  );
}
