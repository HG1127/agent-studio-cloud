"use client";

import { useLayoutEffect, useRef, useState } from "react";

export function BusinessResultExportButtons({ markdown, csv }: { markdown: string; csv: string }) {
  const [status, setStatus] = useState<"idle" | "started" | "failed">("idle");
  const busy = useRef(false);
  const generation = useRef(0);
  const pendingUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useLayoutEffect(() => {
    generation.current += 1;
    setStatus("idle");
    return () => {
      generation.current += 1;
      for (const [url, timer] of pendingUrls.current) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      pendingUrls.current.clear();
    };
  }, [markdown, csv]);

  function download(format: "md" | "csv") {
    if (busy.current) return;
    busy.current = true;
    const owner = generation.current;
    setStatus("idle");
    let url: string | null = null;
    let link: HTMLAnchorElement | null = null;
    try {
      const text = format === "md" ? markdown : csv;
      if (!text) throw new Error("empty export");
      url = URL.createObjectURL(new Blob([text], { type: format === "md" ? "text/markdown;charset=utf-8" : "text/csv;charset=utf-8" }));
      link = document.createElement("a");
      link.href = url;
      link.download = format === "md" ? "已保存业务成果.md" : "交付内容清单.csv";
      document.body.appendChild(link);
      link.click();
      if (generation.current !== owner) return;
      const startedUrl = url;
      const timer = setTimeout(() => {
        if (pendingUrls.current.delete(startedUrl)) URL.revokeObjectURL(startedUrl);
      }, 1000);
      pendingUrls.current.set(startedUrl, timer);
      url = null;
      if (generation.current === owner) setStatus("started");
    } catch {
      if (generation.current === owner) setStatus("failed");
    } finally {
      link?.remove();
      if (url) URL.revokeObjectURL(url);
      busy.current = false;
    }
  }

  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => download("md")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">导出业务成果文档</button>
      <button type="button" onClick={() => download("csv")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">导出交付内容清单</button>
    </div>
    {status === "started" ? <p role="status" className="text-xs leading-5 text-emerald-700">已发起下载，请查看浏览器下载记录；本页不能确认文件是否已保存。</p> : null}
    {status === "failed" ? <p role="alert" className="text-xs leading-5 text-red-700">暂时无法发起下载，请重新操作；未重新创建任务或修改保存结果。</p> : null}
  </div>;
}
