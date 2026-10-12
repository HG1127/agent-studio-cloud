"use client";

import { useEffect, useState } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { HealthResponse } from "@/contracts/health";

type ReadStatus = "waiting" | "checking" | "database-unconfirmed" | "slow";

export function SlowLoadNotice({ delayMs = 10_000 }: { delayMs?: number }) {
  const [status, setStatus] = useState<ReadStatus>("waiting");

  useEffect(() => {
    const controller = new AbortController();
    let requestTimeout: number | undefined;
    const timer = window.setTimeout(() => {
      setStatus("checking");
      requestTimeout = window.setTimeout(() => { setStatus("slow"); controller.abort(); }, 8_000);
      void fetch("/api/health", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const health = HealthResponse.safeParse(await response.json());
        if (!controller.signal.aborted) setStatus(health.success && !health.data.db ? "database-unconfirmed" : "slow");
      }).catch(() => {
        if (!controller.signal.aborted) setStatus("slow");
      }).finally(() => {
        window.clearTimeout(requestTimeout);
      });
    }, delayMs);
    return () => { window.clearTimeout(timer); window.clearTimeout(requestTimeout); controller.abort(); };
  }, [delayMs]);

  if (status === "waiting") return null;
  return <div role="alert" className="flex max-w-2xl flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 sm:flex-row sm:items-start sm:justify-between">
    <div className="flex min-w-0 items-start gap-2"><CircleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" /><div><p className="font-semibold">{status === "database-unconfirmed" ? "数据状态暂时无法确认" : "读取时间比平时长"}</p><p className="mt-0.5 text-xs leading-5">{status === "database-unconfirmed" ? "服务检查未通过，可能是连接缓慢或暂时不可用。请继续等待或稍后重试；此页面没有提交或更改内容。" : status === "checking" ? "正在核对服务状态；请稍候，页面不会自动重复提交。" : "可能是网络或服务响应较慢。您可以继续等待，或稍后手动重新加载。"}</p></div></div>
    <button type="button" onClick={() => window.location.reload()} className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100"><RefreshCw aria-hidden="true" className="size-3.5" />重新加载</button>
  </div>;
}
