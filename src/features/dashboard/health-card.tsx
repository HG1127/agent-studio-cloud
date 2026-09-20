"use client";

import { useEffect, useState } from "react";
import type { Health } from "@/contracts/health";

const LABELS: Record<keyof Health, string> = {
  ok: "整体状态",
  db: "数据库",
  workflow: "执行引擎",
};

export function HealthCard() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: Health) => setHealth(d))
      .catch(() => setHealth(null));
  }, []);

  if (!health) return <p className="text-sm text-gray-400">正在检查系统状态…</p>;
  return (
    <dl className="grid w-full grid-cols-3 gap-4">
      {(Object.keys(LABELS) as (keyof Health)[]).map((key) => (
        <div key={key} className="rounded-lg border p-4 text-center">
          <dt className="text-sm text-gray-500">{LABELS[key]}</dt>
          <dd className={health[key] ? "text-green-600" : "text-red-600"}>
            {health[key] ? "正常" : "异常"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
