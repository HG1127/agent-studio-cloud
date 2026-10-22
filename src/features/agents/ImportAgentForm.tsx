"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileJson2, ShieldCheck, Upload, XCircle } from "lucide-react";
import { importAgentAction } from "@/server/actions/import-agent";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export function ImportAgentForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const importingRef = useRef(false);
  const retryRef = useRef<{ content: string; requestId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function importFile(file: File | undefined) {
    if (!file || importingRef.current) return;
    setFileName(file.name);
    if (file.size > MAX_IMPORT_BYTES) {
      setError("导入文件不能超过 2MB");
      return;
    }
    importingRef.current = true;
    setPending(true);
    setError(null);
    try {
      let payload: unknown;
      let content: string;
      try {
        content = await file.text();
        payload = JSON.parse(content) as unknown;
      } catch {
        setError("无法读取这个 JSON 文件，请检查文件内容");
        return;
      }
      const request = retryRef.current?.content === content
        ? retryRef.current
        : { content, requestId: crypto.randomUUID() };
      retryRef.current = request;
      const result = await importAgentAction(payload, request.requestId);
      if (result.ok) {
        router.push(`/agents/${result.agentId}`);
        return;
      }
      setError(result.error);
    } catch {
      setError("导入请求失败，请检查网络后重试");
    } finally {
      importingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><FileJson2 className="size-5" /></span>
        <div>
          <h2 className="text-base font-semibold text-slate-950">从文件导入助手</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">支持助手定义或单个冻结版本。导入后生成可编辑草稿，发布状态和运行历史不会一并导入。</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-600" />仅接受 JSON 文件</span>
            <span>最大 2MB</span>
          </div>
        </div>
      </div>
      <div>
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 text-center transition hover:border-indigo-400 hover:bg-indigo-50/50">
          <Upload className={`size-5 ${pending ? "animate-bounce text-indigo-500" : "text-slate-400"}`} />
          <span className="mt-2 text-sm font-semibold text-slate-800">{pending ? "正在导入…" : "选择 JSON 文件"}</span>
          <span className="mt-1 max-w-full truncate text-xs text-slate-500">{fileName || "从电脑中选择一个文件"}</span>
          <input aria-label="选择助手定义文件" type="file" accept="application/json,.json" disabled={pending} className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void importFile(file);
            }} />
        </label>
        {error ? <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm leading-5 text-red-700"><XCircle className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
      </div>
    </div>
  );
}
