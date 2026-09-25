"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importAgentAction } from "@/server/actions/import-agent";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export function ImportAgentForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const importingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function importFile(file: File | undefined) {
    if (!file || importingRef.current) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError("导入文件不能超过 2MB");
      return;
    }
    importingRef.current = true;
    setPending(true);
    setError(null);
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(await file.text()) as unknown;
      } catch {
        setError("无法读取这个 JSON 文件，请检查文件内容");
        return;
      }
      const result = await importAgentAction(payload);
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
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-gray-300 p-4">
      <div>
        <h2 className="text-sm font-semibold">导入助手</h2>
        <p className="mt-1 text-xs text-gray-500">支持助手定义或单个冻结版本。导入后生成可编辑草稿，发布状态和运行历史不会一并导入。</p>
      </div>
      <label className="w-fit cursor-pointer rounded-md border border-gray-300 px-3 py-2 text-sm hover:border-gray-500">
        {pending ? "正在导入…" : "选择 JSON 文件"}
        <input aria-label="选择助手定义文件" type="file" accept="application/json,.json" disabled={pending} className="sr-only"
          onChange={(event) => importFile(event.target.files?.[0])} />
      </label>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
