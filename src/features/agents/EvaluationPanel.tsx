"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EvaluationCaseView, EvaluationRunView } from "@/contracts/evaluation";
import { archiveEvaluationCaseAction, createEvaluationCaseAction, startEvaluationAction } from "@/server/actions/evaluations";

export function EvaluationPanel({ agentId, cases, runs }: {
  agentId: string;
  cases: EvaluationCaseView[];
  runs: EvaluationRunView[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [inputText, setInputText] = useState('{"input":"请处理这条验收任务"}');
  const [expectedText, setExpectedText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runs.some((run) => run.status === "running")) return;
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [router, runs]);

  async function createCase() {
    setError(null);
    let input: Record<string, unknown>;
    try {
      const parsed = JSON.parse(inputText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      input = parsed as Record<string, unknown>;
    } catch {
      setError("运行输入必须是一个 JSON 对象");
      return;
    }
    setPending(true);
    try {
      const result = await createEvaluationCaseAction({
        agentId,
        name,
        input,
        expectations: expectedText.trim() ? [{ path: "", operator: "contains", value: expectedText.trim() }] : [],
      });
      if (!result.ok) setError(result.error);
      else {
        setName("");
        setExpectedText("");
        router.refresh();
      }
    } catch {
      setError("保存验收样例失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  async function startEvaluation() {
    setPending(true);
    setError(null);
    try {
      const result = await startEvaluationAction(agentId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } catch {
      setError("启动自动验收失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  async function archiveCase(caseId: string) {
    setPending(true);
    setError(null);
    try {
      const result = await archiveEvaluationCaseAction(agentId, caseId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } catch {
      setError("删除验收样例失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">自动验收</h2>
          <p className="mt-1 text-xs text-gray-500">用保存的业务样例批量验证当前发布版本。</p>
        </div>
        <button type="button" disabled={pending || cases.length === 0} onClick={startEvaluation}
          className="rounded-md bg-violet-700 px-3 py-2 text-sm text-white hover:bg-violet-600 disabled:bg-gray-300">
          {pending ? "正在处理…" : "运行全部样例"}
        </button>
      </div>
      {error ? <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
      <div className="grid gap-2 md:grid-cols-[1fr_2fr_1fr_auto]">
        <input aria-label="样例名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="样例名称"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <input aria-label="运行输入" value={inputText} onChange={(event) => setInputText(event.target.value)} placeholder='{"input":"业务输入"}'
          className="rounded-md border border-gray-300 px-3 py-2 font-mono text-sm" />
        <input aria-label="结果应包含" value={expectedText} onChange={(event) => setExpectedText(event.target.value)} placeholder="可不填"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <button type="button" disabled={pending || !name.trim()} onClick={createCase}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:text-gray-400">添加样例</button>
      </div>
      {cases.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {cases.map((testCase) => (
            <li key={testCase.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>{testCase.name}</span>
              <button type="button" disabled={pending} onClick={() => archiveCase(testCase.id)} className="text-xs text-gray-500 hover:text-red-600">删除</button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-gray-500">还没有验收样例。</p>}
      {runs.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
          <h3 className="text-xs font-medium text-gray-600">最近验收</h3>
          {runs.map((run) => (
            <div key={run.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span>版本 {run.version}</span>
              <span className={run.status === "running" ? "text-blue-600" : run.failedCount > 0 ? "text-red-600" : "text-emerald-600"}>
                {run.status === "running" ? "运行中" : run.failedCount > 0 ? "未通过" : "已通过"}
              </span>
              <span className="text-xs text-gray-500">通过 {run.passedCount} / 失败 {run.failedCount} / 共 {run.totalCount}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
