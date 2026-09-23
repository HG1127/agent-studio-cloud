import { KnowledgeList, UploadSourceForm } from "@/features/knowledge/KnowledgeList";
import { listKnowledgeSources } from "@/server/queries/knowledge";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const sources = await listKnowledgeSources();
  return (
    <main className="mx-auto w-full max-w-3xl px-8 py-8">
      <h1 className="text-xl font-semibold text-gray-900">知识库</h1>
      <p className="mt-1 text-sm text-gray-600">上传业务资料，运行时会按关键词检索相关内容给助手参考。</p>
      <div className="mt-6"><UploadSourceForm /></div>
      <div className="mt-6"><KnowledgeList initial={sources} /></div>
    </main>
  );
}
