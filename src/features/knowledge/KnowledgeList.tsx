"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { KnowledgeUploadResult, MAX_KNOWLEDGE_FILENAME_LENGTH, type KnowledgeSourceView } from "@/contracts/knowledge";
import { setKnowledgeSourceArchivedAction } from "@/server/actions/archive-knowledge-source";
import { retryKnowledgeSourceAction } from "@/server/actions/retry-knowledge-source";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { KnowledgeSourceDetails } from "./KnowledgeSourceDetails";

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
  const [selectedFileName, setSelectedFileName] = useState("尚未选择文件");
  const mounted = useRef(false);
  const generation = useRef(0);
  const selectionRevision = useRef(0);
  const selectedFile = useRef<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = useRef<{ generation: number; revision: number; file: File; form: HTMLFormElement; input: HTMLInputElement } | null>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    generation.current += 1;
    return () => { mounted.current = false; generation.current += 1; active.current = null; };
  }, []);

  function ownsRequest(owner: NonNullable<typeof active.current>) {
    return mounted.current && generation.current === owner.generation && active.current === owner;
  }
  function ownsSelection(owner: NonNullable<typeof active.current>) {
    return ownsRequest(owner) && selectionRevision.current === owner.revision && selectedFile.current === owner.file
      && fileInput.current === owner.input && owner.form.isConnected && owner.input.files?.[0] === owner.file;
  }

  return (
    <section aria-busy={uploading} className="content-card">
      <h2 className="section-title">上传业务资料</h2>
      <p className="mt-1 text-sm text-slate-500">上传后会开始解析；只有显示“已就绪”的资料才会参与助手检索。</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!mounted.current || active.current) return;
          const form = event.currentTarget;
          const input = fileInput.current;
          const file = input?.files?.[0];
          if (!file || file.size === 0) {
            setError("请选择要上传的文件");
            return;
          }
          if (file.name.length > MAX_KNOWLEDGE_FILENAME_LENGTH) {
            setError(`文件名不能超过 ${MAX_KNOWLEDGE_FILENAME_LENGTH} 个字符`);
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
          if (!input) return;
          let data: FormData;
          try { data = new FormData(form); data.set("file", file); }
          catch { setError("暂时无法准备文件，没有发出上传请求；请重新选择后手动上传。"); return; }
          if (selectedFile.current !== file) {
            selectedFile.current = file;
            selectionRevision.current += 1;
            setSelectedFileName(file.name);
          }
          const owner = { generation: generation.current, revision: selectionRevision.current, file, form, input };
          active.current = owner;
          setUploading(true);
          setError(null);
          setNotice(null);
          try {
            const response = await fetch("/api/knowledge/sources", { method: "POST", body: data });
            if (!ownsSelection(owner)) return;
            const parsed = KnowledgeUploadResult.safeParse(await response.json());
            if (!ownsSelection(owner)) return;
            if (!parsed.success || !response.ok && parsed.data.ok) {
              setError("上传结果无法读取，请刷新后查看资料状态");
              setNotice("本次文件选择仍保留；尚未取得可确认的上传回执，请先核对资料列表再决定是否重传。");
              router.refresh();
              return;
            }
            const result = parsed.data;
            if (!result.ok) {
              setError(result.error);
              setNotice("本次未取得上传成功回执，文件选择仍保留。错误回复不能证明资料或原文件未保存，也不能确认解析已启动；请先核对资料列表再决定是否重传。");
              router.refresh();
              return;
            }
            const recordNotice = result.deduped ? "这份文件已有记录，未重复创建。" : "资料已接收。";
            const statusNotice = result.source.status === "indexed"
              ? "当前已就绪，可在资料库中检索。"
              : result.source.status === "parsing"
                ? "当前正在解析，完成后才能用于资料检索。"
                : result.source.status === "failed"
                  ? "解析失败，请在资料列表查看原因。"
                  : "请在资料列表核对当前状态。";
            const originalNotice = result.blobStored
              ? ""
              : "原文件尚未保存；以后无法直接重新解析，需要重新上传同一文件。";
            setNotice(`${recordNotice}${statusNotice}${originalNotice}`);
            form.reset();
            selectedFile.current = null;
            selectionRevision.current += 1;
            setSelectedFileName("尚未选择文件");
            router.refresh();
          } catch {
            if (!ownsSelection(owner)) return;
            setError("暂时无法确认是否上传成功。请先核对资料列表，再决定是否重新上传。");
            router.refresh();
          } finally {
            if (ownsRequest(owner)) { active.current = null; setUploading(false); }
          }
        }}
        className="mt-4 flex flex-wrap items-center gap-3"
      >
        <label className={`inline-flex items-center gap-3 text-sm ${uploading ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
          <span className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-700">
            选择文件
          </span>
          <span className="max-w-72 truncate text-slate-500">{selectedFileName}</span>
          <input
            ref={fileInput}
            aria-label="选择业务资料"
            type="file"
            name="file"
            disabled={uploading}
            className="sr-only"
            accept=".pdf,.docx,.txt,.md,.html,.json,.csv,.xml"
            onChange={(event) => {
              if (!mounted.current) return;
              selectedFile.current = event.currentTarget.files?.[0] ?? null;
              selectionRevision.current += 1;
              setSelectedFileName(selectedFile.current?.name ?? "尚未选择文件");
              setNotice(null);
              if (active.current) {
                setError("上传期间文件选择发生变化，后来选择的文件尚未提交。请先核对原上传记录；这不代表后台请求已取消。");
                return;
              }
              setError(null);
            }}
          />
        </label>
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

export function KnowledgeList({ initial, archived = false, serverManaged = false, hasFilter = false, emptyPageHref }: { initial: KnowledgeSourceView[]; archived?: boolean; serverManaged?: boolean; hasFilter?: boolean; emptyPageHref?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [confirmSource, setConfirmSource] = useState<KnowledgeSourceView | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return initial;
    return initial.filter((source) => source.name.toLocaleLowerCase("zh-CN").includes(normalized));
  }, [initial, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = serverManaged ? initial : filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  if (initial.length === 0) {
    const message = emptyPageHref
      ? hasFilter ? "当前页没有匹配的资料。" : "当前页没有资料。"
      : hasFilter ? "没有找到匹配的资料，请修改文件名后再查找。"
        : archived ? "没有已归档的资料" : "还没有上传过文档；解析就绪的资料可供助手在运行时检索。";
    return <div className="space-y-2 text-sm text-gray-600"><p>{message}</p>
      {emptyPageHref ? <Link href={emptyPageHref} className="inline-block font-semibold text-indigo-700 hover:underline">返回上一页</Link> : null}
    </div>;
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
          <li key={source.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 break-all text-sm font-semibold text-slate-900">{source.name}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${source.parsingStalled || source.status === "failed" ? "bg-red-50 text-red-700" : source.status === "indexed" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{source.parsingStalled ? "解析已中断" : STATUS_LABELS[source.status]}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{(source.sizeBytes / 1024).toFixed(1)} KB · {source.chunkCount} 段 · 上传于 {source.createdAt.slice(0, 10)}</p>
              {source.status === "parsing" && !source.parsingStalled ? <p className="mt-1 text-xs text-slate-600">解析在后台继续；可点页面顶部“重新读取状态”查看结果。解析就绪后才能用于助手检索。</p> : null}
              {(source.status === "failed" || source.parsingStalled) ? <p className="mt-1 break-words text-xs text-red-700">{source.error ? `${source.error} · ` : ""}{source.hasOriginal ? "可直接重新解析" : "重新上传同一文件即可重试"}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:justify-end">
              <KnowledgeSourceDetails source={source} />
              {!archived && (source.status === "failed" || source.parsingStalled) && source.hasOriginal ? (
                <button
                  type="button"
                  disabled={pending}
                  className="font-medium text-indigo-700 hover:underline disabled:opacity-50"
                  onClick={() => {
                    setError(null);
                    setActiveSourceId(source.id);
                    startTransition(async () => {
                      try {
                        const result = await retryKnowledgeSourceAction(source.id);
                        if (!result.ok) setError(result.error);
                        else router.refresh();
                      } catch {
                        setError("重新解析失败，请检查网络后重试");
                      } finally {
                        setActiveSourceId(null);
                      }
                    });
                  }}
                >
                  {activeSourceId === source.id && pending ? "正在重新解析…" : "重新解析"}
                </button>
              ) : null}
              {source.hasOriginal ? <a href={`/api/knowledge/sources/${source.id}/file`} download className="font-medium text-indigo-700 hover:underline">下载原文件</a>
                : <span className="text-slate-400">未保留原文件</span>}
              <button
                type="button"
                disabled={pending}
                className="font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
                onClick={() => { setError(null); setConfirmSource(source); }}
              >
                {activeSourceId === source.id && pending ? "正在处理…" : archived ? "恢复" : "归档"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!serverManaged && pageCount > 1 ? <nav aria-label="资料列表分页" className="mt-4 flex items-center justify-end gap-3 text-sm">
        <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">上一页</button>
        <span>第 {currentPage} / {pageCount} 页</span>
        <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">下一页</button>
      </nav> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-red-600">{error}</p> : null}
      <ConfirmDialog
        open={confirmSource !== null}
        onOpenChange={(open) => { if (!open) setConfirmSource(null); }}
        title={archived ? "恢复这份资料？" : "归档这份资料？"}
        description={archived
          ? `“${confirmSource?.name ?? "这份资料"}”恢复后，解析就绪的内容可再次用于助手检索。`
          : `“${confirmSource?.name ?? "这份资料"}”归档后不再参与助手检索，之后可以从已归档资料中恢复。`}
        confirmLabel={archived ? "确认恢复" : "确认归档"}
        tone="warning"
        pending={pending}
        onConfirm={() => {
          const source = confirmSource;
          if (!source) return;
          setError(null);
          setActiveSourceId(source.id);
          startTransition(async () => {
            try {
              const result = await setKnowledgeSourceArchivedAction({ sourceId: source.id, archived: !archived });
              if (!result.ok) setError(result.error);
              else router.refresh();
            } catch {
              setError(archived ? "恢复资料失败，请检查网络后重试" : "归档资料失败，请检查网络后重试");
            } finally {
              setConfirmSource(null);
              setActiveSourceId(null);
            }
          });
        }}
      />
    </>
  );
}
