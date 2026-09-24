"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { KnowledgeUploadResult, type KnowledgeSourceView } from "@/contracts/knowledge";
import { setKnowledgeSourceArchivedAction } from "@/server/actions/archive-knowledge-source";

const STATUS_LABELS: Record<KnowledgeSourceView["status"], string> = {
  parsing: "解析中",
  indexed: "已就绪",
  failed: "解析失败",
  archived: "已归档",
};
const PAGE_SIZE = 20;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = new Set(["pdf", "docx", "txt", "md", "html", "json", "csv", "xml"]);

export function UploadSourceForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <section className="rounded-lg border bg-white p-4">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const file = form.querySelector<HTMLInputElement>('input[name="file"]')?.files?.[0];
          if (!file || file.size === 0) {
            setError("请选择要上传的文件");
            return;
          }
          const extension = file.name.split(".").pop()?.toLocaleLowerCase("zh-CN") ?? "";
          if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
            setError("暂不支持这种文件类型，可上传：PDF、DOCX、TXT、MD、HTML、JSON、CSV、XML");
            return;
          }
          if (file.size > MAX_UPLOAD_BYTES) {
            setError("文件超过 4MB 限制，请拆分后再上传");
            return;
          }
          const data = new FormData(form);
          setUploading(true);
          setError(null);
          setNotice(null);
          try {
            const response = await fetch("/api/knowledge/sources", { method: "POST", body: data });
            const parsed = KnowledgeUploadResult.safeParse(await response.json());
            if (!parsed.success) {
              setError("上传结果无法读取，请刷新后查看资料状态");
              return;
            }
            const result = parsed.data;
            if (!result.ok) {
              setError(result.error);
              return;
            }
            if (!result.blobStored) {
              setNotice("资料已接收，但原文件尚未保存。需要长期留存原文件时，请先配置私有文件存储。");
            }
            form.reset();
            router.refresh();
          } catch {
            setError("上传失败，请检查网络后重试");
          } finally {
            setUploading(false);
          }
        }}
        className="flex flex-wrap items-center gap-3"
      >
        <input type="file" name="file" className="text-sm" accept=".pdf,.docx,.txt,.md,.html,.json,.csv,.xml" />
        <button type="submit" disabled={uploading} className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {uploading ? "上传中…" : "上传文档"}
        </button>
        <span className="text-xs text-gray-500">支持 PDF / DOCX / TXT / MD / HTML / JSON / CSV / XML，不超过 4MB</span>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="mt-2 text-sm text-amber-800">{notice}</p>}
    </section>
  );
}

export function KnowledgeList({ initial, archived = false, serverManaged = false }: { initial: KnowledgeSourceView[]; archived?: boolean; serverManaged?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const hasParsing = initial.some((source) => source.status === "parsing");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return initial;
    return initial.filter((source) => source.name.toLocaleLowerCase("zh-CN").includes(normalized));
  }, [initial, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = serverManaged ? initial : filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => {
    if (!hasParsing) return;
    const timer = setInterval(() => startTransition(() => router.refresh()), 2000);
    return () => clearInterval(timer);
  }, [hasParsing, router]);

  if (initial.length === 0) {
    return <p className="text-sm text-gray-600">{archived ? "没有已归档的资料" : "还没有上传过文档，上传第一份业务资料后，助手的「读取资料」步骤就能真正查到内容。"}</p>;
  }
  return (
    <>
      {!serverManaged ? <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex min-w-64 flex-1 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
          <span className="shrink-0 text-gray-500">查找资料</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="输入文件名"
            className="min-w-0 flex-1 outline-none"
          />
        </label>
        <span className="text-sm text-gray-500">共 {filtered.length} 份</span>
      </div> : null}
      {visible.length === 0 ? <p className="py-4 text-sm text-gray-600">没有找到匹配的资料</p> : null}
      <ul className="space-y-2">
        {visible.map((source) => (
          <li key={source.id} className="flex items-center justify-between rounded-lg border bg-white p-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{source.name}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {STATUS_LABELS[source.status]} · {(source.sizeBytes / 1024).toFixed(1)} KB · {source.chunkCount} 段 · 上传于 {source.createdAt.slice(0, 10)}
              {source.status === "failed" && source.error ? ` · ${source.error} · 重新上传同一文件即可重试` : ""}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-3">
              {source.hasOriginal ? <a href={`/api/knowledge/sources/${source.id}/file`} download className="text-xs text-blue-700 hover:underline">下载原文件</a>
                : <span className="text-xs text-gray-400">未保留原文件</span>}
              <button
                type="button"
                disabled={pending}
                className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50"
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    try {
                      const result = await setKnowledgeSourceArchivedAction({ sourceId: source.id, archived: !archived });
                      if (!result.ok) setError(result.error);
                      else router.refresh();
                    } catch {
                      setError(archived ? "恢复资料失败，请检查网络后重试" : "归档资料失败，请检查网络后重试");
                    }
                  });
                }}
              >
                {archived ? "恢复" : "归档"}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {!serverManaged && pageCount > 1 ? <nav aria-label="资料列表分页" className="mt-4 flex items-center justify-end gap-3 text-sm">
        <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">上一页</button>
        <span>第 {currentPage} / {pageCount} 页</span>
        <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">下一页</button>
      </nav> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-red-600">{error}</p> : null}
    </>
  );
}
