"use client";

import { useEffect, useState } from "react";
import { HealthResponse, type Health } from "@/contracts/health";

const LABELS: Record<keyof Health, string> = {
  ok: "整体状态",
  db: "数据库",
  workflow: "执行引擎",
};

type HealthState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; health: Health };

export function HealthCard() {
  const [state, setState] = useState<HealthState>({ phase: "loading" });
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: unknown) => {
        const parsed = HealthResponse.safeParse(data);
        setState(
          parsed.success ? { phase: "ready", health: parsed.data } : { phase: "error" },
        );
      })
      .catch(() => setState({ phase: "error" }));
  }, []);

  if (state.phase === "loading") {
    return <p className="text-sm text-gray-400">正在检查系统状态…</p>;
  }
  if (state.phase === "error") {
    return <p className="text-sm text-red-600">系统状态暂时无法获取</p>;
  }
  return (
    <dl className="grid w-full grid-cols-3 gap-4">
      {(Object.keys(LABELS) as (keyof Health)[]).map((key) => (
        <div key={key} className="rounded-lg border p-4 text-center">
          <dt className="text-sm text-gray-500">{LABELS[key]}</dt>
          <dd className={state.health[key] ? "text-green-600" : "text-red-600"}>
            {state.health[key] ? "正常" : "异常"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
