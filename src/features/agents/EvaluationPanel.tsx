"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EvaluationCaseView, EvaluationExpectation, EvaluationRunView } from "@/contracts/evaluation";
import {
  archiveEvaluationCaseAction,
  createEvaluationCaseAction,
  startEvaluationAction,
  updateEvaluationCaseAction,
} from "@/server/actions/evaluations";

function commonExpectation(expectations: EvaluationExpectation[]): string {
  const row = expectations.find((item) => item.path === "" && item.operator === "contains");
  return typeof row?.value === "string" ? row.value : "";
}

function mergeCommonExpectation(expectations: EvaluationExpectation[], value: string): EvaluationExpectation[] {
  const preserved = expectations.filter((item) => !(item.path === "" && item.operator === "contains"));
  return value.trim() ? [...preserved, { path: "", operator: "contains", value: value.trim() }] : preserved;
}

function expectationLabel(expectation: EvaluationExpectation): string {
  const target = expectation.path || "全部结果";
  if (expectation.operator === "exists") return `${target}需要存在`;
  if (expectation.operator === "equals") return `${target}需要等于 ${JSON.stringify(expectation.value)}`;
  return `${target}需要包含“${String(expectation.value ?? "")}”`;
}

export function EvaluationPanel({ agentId, cases, runs }: {
  agentId: string;
  cases: EvaluationCaseView[];
  runs: EvaluationRunView[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [inputText, setInputText] = useState('{"input":"请处理这条验收任务"}');
  const [expectedText, setExpectedText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingExpectations, setEditingExpectations] = useState<EvaluationExpectation[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runs.some((run) => run.status === "running")) return;
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [router, runs]);

  function resetCaseForm() {
    setName("");
    setInputText('{"input":"请处理这条验收任务"}');
    setExpectedText("");
    setEditingId(null);
    setEditingExpectations([]);
  }

  function editCase(testCase: EvaluationCaseView) {
    setError(null);
    setEditingId(testCase.id);
    setName(testCase.name);
    setInputText(JSON.stringify(testCase.input));
    setExpectedText(commonExpectation(testCase.expectations));
    setEditingExpectations(testCase.expectations);
  }

  async function saveCase() {
    setError(null);
    let input: Record<string, unknown>;
    try {
      const parsed = JSON.parse(inputText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      input = parsed as Record<string, unknown>;
    } catch {
      setError("运行输入必须使用对象格式");
      return;
    }
    setPending(true);
    try {
      const payload = {
        agentId,
        name,
        input,
        expectations: editingId
          ? mergeCommonExpectation(editingExpectations, expectedText)
          : expectedText.trim() ? [{ path: "", operator: "contains" as const, value: expectedText.trim() }] : [],
      };
      const result = editingId
        ? await updateEvaluationCaseAction({ ...payload, caseId: editingId })
        : await createEvaluationCaseAction(payload);
      if (!result.ok) setError(result.error);
      else {
        resetCaseForm();
        router.refresh();
      }
    } catch {
      setError(editingId ? "更新验收样例失败，请稍后重试" : "保存验收样例失败，请稍后重试");
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
          <p className="mt-1 text-xs text-gray-500">优先验证待验收版本；全部通过后自动上线。没有待验收版本时验证当前版本。</p>
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
        <button type="button" disabled={pending || !name.trim()} onClick={saveCase}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:text-gray-400">{editingId ? "保存修改" : "添加样例"}</button>
      </div>
      {editingId ? <button type="button" disabled={pending} onClick={resetCaseForm} className="w-fit text-xs text-gray-500 hover:text-gray-800">取消编辑</button> : null}
      {cases.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {cases.map((testCase) => (
            <li key={testCase.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <span>{testCase.name}</span>
                <details className="mt-1 text-xs text-gray-500">
                  <summary className="cursor-pointer">查看样例内容</summary>
                  <p className="mt-1 break-words">运行输入：{JSON.stringify(testCase.input)}</p>
                  {testCase.expectations.length > 0 ? <ul className="mt-1 list-disc pl-4">
                    {testCase.expectations.map((expectation, index) => <li key={index}>{expectationLabel(expectation)}</li>)}
                  </ul> : <p className="mt-1">只检查流程是否成功完成</p>}
                </details>
              </div>
              <span className="flex shrink-0 gap-3">
                <button type="button" disabled={pending} onClick={() => editCase(testCase)} className="text-xs text-blue-700 hover:underline">编辑</button>
                <button type="button" disabled={pending} onClick={() => archiveCase(testCase.id)} className="text-xs text-gray-500 hover:text-red-600">删除</button>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-gray-500">还没有验收样例。</p>}
      {runs.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
          <h3 className="text-xs font-medium text-gray-600">最近验收</h3>
          {runs.map((run) => (
            <div key={run.id} className="rounded-md border border-gray-100 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span>版本 {run.version}</span>
                <span className={run.status === "running" ? "text-blue-600" : run.failedCount > 0 ? "text-red-600" : "text-emerald-600"}>
                  {run.status === "running" ? "运行中" : run.failedCount > 0 ? "未通过" : "已通过"}
                </span>
                <span className="text-xs text-gray-500">通过 {run.passedCount} / 失败 {run.failedCount} / 共 {run.totalCount}</span>
              </div>
              {run.results.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                  {run.results.map((result) => (
                    <li key={result.caseId} className="flex flex-wrap items-start justify-between gap-2 text-xs">
                      <div>
                        <span className={result.status === "failed" ? "text-red-700" : result.status === "passed" ? "text-emerald-700" : "text-blue-700"}>
                          {result.caseName}：{result.status === "failed" ? "未通过" : result.status === "passed" ? "通过" : "运行中"}
                        </span>
                        {result.error ? <p className="mt-0.5 text-red-600">{result.error}</p> : null}
                      </div>
                      {result.runId ? <Link href={`/runs/${result.runId}`} className="text-blue-700 hover:underline">查看运行</Link> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
