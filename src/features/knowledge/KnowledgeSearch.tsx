import type { KnowledgeSearchResult } from "@/contracts/knowledge";

export function KnowledgeSearch({ result }: { result: KnowledgeSearchResult | null }) {
  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold">验证资料检索</h2>
        <p className="mt-1 text-xs text-gray-500">输入业务关键词，确认助手运行时能找到哪些已就绪资料。</p>
      </div>
      <form method="get" className="mt-3 flex flex-wrap gap-2">
        <input name="q" aria-label="检索关键词" defaultValue={result?.query ?? ""} maxLength={200} required
          placeholder="例如：退货期限" className="min-w-56 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700">开始检索</button>
      </form>
      {result ? (
        <div className="mt-4">
          <p role="status" className="text-sm text-gray-600">
            {result.hits.length > 0 ? `找到 ${result.hits.length} 段相关内容` : "没有找到相关内容，请换个关键词或检查资料解析状态。"}
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
