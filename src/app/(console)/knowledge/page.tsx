import { KnowledgeList, UploadSourceForm } from "@/features/knowledge/KnowledgeList";
import { KnowledgeSearch } from "@/features/knowledge/KnowledgeSearch";
import { listKnowledgeSources, searchKnowledgeChunks } from "@/server/queries/knowledge";

export const dynamic = "force-dynamic";

export default async function KnowledgePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = rawQuery?.trim().slice(0, 200) ?? "";
  const [sources, archivedSources, searchResult] = await Promise.all([
    listKnowledgeSources(),
    listKnowledgeSources(true),
    query ? searchKnowledgeChunks(query) : null,
  ]);
  return (
    <main className="mx-auto w-full max-w-3xl px-8 py-8">
      <h1 className="text-xl font-semibold text-gray-900">知识库</h1>
      <p className="mt-1 text-sm text-gray-600">上传业务资料，运行时会按关键词检索相关内容给助手参考。</p>
      <div className="mt-6"><UploadSourceForm /></div>
      <KnowledgeSearch result={searchResult} />
      <div className="mt-6"><KnowledgeList initial={sources} /></div>
      {archivedSources.length > 0 ? <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">已归档资料</h2>
        <KnowledgeList initial={archivedSources} archived />
      </section> : null}
    </main>
  );
}
