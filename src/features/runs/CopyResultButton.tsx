"use client";

import { useState } from "react";

export function CopyResultButton({ result, text, label = "复制最终结果" }: { result: unknown; text?: string; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    setStatus("idle");
    try {
      const content = text || (typeof result === "string" ? result : JSON.stringify(result, null, 2));
      if (!content) throw new Error("empty result");
      await navigator.clipboard.writeText(content);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" onClick={copy} className="w-fit rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-500">
      {label}
    </button>
    {status === "copied" ? <span role="status" className="text-xs text-emerald-700">已复制</span> : null}
    {status === "failed" ? <span role="alert" className="text-xs text-red-600">复制失败，请选中文本后手动复制</span> : null}
  </div>;
}
