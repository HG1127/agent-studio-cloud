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
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    fetch("/api/health", { signal: controller.signal })
      .then((r) => r.json())
      .then((data: unknown) => {
        if (!active) return;
        const parsed = HealthResponse.safeParse(data);
        setState(
          parsed.success ? { phase: "ready", health: parsed.data } : { phase: "error" },
        );
      })
      .catch(() => {
        if (active) setState({ phase: "error" });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  if (state.phase === "loading") {
    return <p className="text-sm text-gray-400">正在检查系统状态…</p>;
  }
  if (state.phase === "error") {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm text-red-600">系统状态暂时无法获取</p>
        <button
          type="button"
          onClick={() => {
            setState({ phase: "loading" });
            setAttempt((value) => value + 1);
          }}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-gray-500"
        >
          重新检查
        </button>
      </div>
    );
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
