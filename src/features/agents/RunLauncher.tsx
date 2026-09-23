"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { startRunAction } from "@/server/actions/start-run";

// 运行入口：输入 JSON 文本域（默认 {}）→ startRunAction → 跳转运行详情。
// 非法 JSON 前端拦截并提示中文错误，不发请求；启动失败展示动作返回的中文错误。
export function RunLauncher({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [inputText, setInputText] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function parseInput(): Record<string, unknown> | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(inputText);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  }

  async function handleRun() {
    setError(null);
    const input = parseInput();
    if (!input) {
      setError("请输入正确的 JSON 格式");
      return;
    }
    setPending(true);
    const result = await startRunAction({ agentId, input });
    if (result.ok) {
      router.push(`/runs/${result.runId}`);
    } else {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <label className="flex flex-col gap-1 text-sm text-gray-700">
        运行输入（JSON）
        <textarea
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          rows={4}
          className="rounded-md border border-gray-300 bg-white p-2 font-mono text-sm"
        />
      </label>
      {error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
        </div>
      ) : null}
      <button
        type="button"
        onClick={handleRun}
        disabled={pending}
        className="w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-400"
      >
        {pending ? "正在启动…" : "运行此助手"}
      </button>
    </section>
  );
}
