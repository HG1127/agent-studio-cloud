"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { KnowledgeUploadResult, type KnowledgeSourceView } from "@/contracts/knowledge";
import { archiveKnowledgeSourceAction } from "@/server/actions/archive-knowledge-source";

const STATUS_LABELS: Record<KnowledgeSourceView["status"], string> = {
  parsing: "解析中",
  indexed: "已就绪",
  failed: "解析失败",
  archived: "已归档",
};

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
        <span className="text-xs text-gray-500">支持 PDF / DOCX / TXT / MD / HTML / JSON / CSV / XML，不超过 8MB</span>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="mt-2 text-sm text-amber-800">{notice}</p>}
    </section>
  );
}

export function KnowledgeList({ initial }: { initial: KnowledgeSourceView[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const hasParsing = initial.some((source) => source.status === "parsing");
  useEffect(() => {
    if (!hasParsing) return;
    const timer = setInterval(() => startTransition(() => router.refresh()), 2000);
    return () => clearInterval(timer);
  }, [hasParsing, router]);

  if (initial.length === 0) {
    return <p className="text-sm text-gray-600">还没有上传过文档，上传第一份业务资料后，助手的「读取资料」步骤就能真正查到内容。</p>;
  }
  return (
    <ul className="space-y-2">
      {initial.map((source) => (
        <li key={source.id} className="flex items-center justify-between rounded-lg border bg-white p-3">
          <div>
            <p className="text-sm font-medium text-gray-900">{source.name}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {STATUS_LABELS[source.status]} · {(source.sizeBytes / 1024).toFixed(1)} KB · {source.chunkCount} 段 · 上传于 {source.createdAt.slice(0, 10)}
              {source.status === "failed" && source.error ? ` · ${source.error}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="text-xs text-gray-500 hover:text-gray-900"
            onClick={async () => {
              await archiveKnowledgeSourceAction(source.id);
              router.refresh();
            }}
          >
            删除
          </button>
        </li>
      ))}
    </ul>
  );
}
