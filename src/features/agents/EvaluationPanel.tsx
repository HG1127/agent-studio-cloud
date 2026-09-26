"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EvaluationExpectation as EvaluationExpectationSchema, MAX_EVALUATION_CASES, MAX_EVALUATION_EXPECTATIONS, type EvaluationCaseView, type EvaluationExpectation, type EvaluationRunView } from "@/contracts/evaluation";
import {
  createEvaluationCaseAction,
  generateEvaluationCasesAction,
  startEvaluationAction,
  setEvaluationCaseArchivedAction,
  updateEvaluationCaseAction,
} from "@/server/actions/evaluations";

type AdvancedExpectationDraft = { path: string; operator: "equals" | "contains" | "exists"; valueText: string };

function commonExpectation(expectations: EvaluationExpectation[]): string {
  const row = expectations.find((item) => item.path === "" && item.operator === "contains");
  return typeof row?.value === "string" ? row.value : "";
}

function mergeCommonExpectation(expectations: EvaluationExpectation[], value: string): EvaluationExpectation[] {
  const preserved = expectations.filter((item) => !(item.path === "" && item.operator === "contains"));
  return value.trim() ? [...preserved, { path: "", operator: "contains", value: value.trim() }] : preserved;
}

function advancedDraft(expectation: EvaluationExpectation): AdvancedExpectationDraft {
  return {
    path: expectation.path,
    operator: expectation.operator,
    valueText: expectation.operator === "exists"
      ? ""
      : typeof expectation.value === "string"
        ? expectation.value
        : JSON.stringify(expectation.value ?? ""),
  };
}

function expectationFromDraft(draft: AdvancedExpectationDraft): unknown {
  if (draft.operator === "exists") return { path: draft.path.trim(), operator: "exists" };
  if (draft.operator === "contains") return { path: draft.path.trim(), operator: "contains", value: draft.valueText };
  let value: unknown = draft.valueText;
  try { value = JSON.parse(draft.valueText) as unknown; } catch { /* 普通文字按字符串比较 */ }
  return { path: draft.path.trim(), operator: "equals", value };
}

function expectationLabel(expectation: EvaluationExpectation): string {
  const target = expectation.path || "全部结果";
  if (expectation.operator === "exists") return `${target}需要存在`;
  if (expectation.operator === "equals") return `${target}需要等于 ${JSON.stringify(expectation.value)}`;
  return `${target}需要包含“${String(expectation.value ?? "")}”`;
}

export function EvaluationPanel({
  agentId,
  cases,
  archivedCases = [],
  runs,
  archivedPage = 1,
  hasMoreArchived = false,
  versionsPage = 1,
  evaluationRunning,
  runsPage = 1,
  hasMoreRuns = false,
}: {
  agentId: string;
  cases: EvaluationCaseView[];
  archivedCases?: EvaluationCaseView[];
  runs: EvaluationRunView[];
  archivedPage?: number;
  hasMoreArchived?: boolean;
  versionsPage?: number;
  evaluationRunning?: boolean;
  runsPage?: number;
  hasMoreRuns?: boolean;
}) {
  const evaluationRequestIdRef = useRef<string | null>(null);
  const router = useRouter();
  const [name, setName] = useState("");
  const [inputText, setInputText] = useState('{"input":"请处理这条验收任务"}');
  const [expectedText, setExpectedText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null);
  const [advancedExpectations, setAdvancedExpectations] = useState<AdvancedExpectationDraft[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isEvaluationRunning = evaluationRunning ?? runs.some((run) => run.status === "running");
  const detailHref = (nextArchivedPage: number, nextRunsPage: number) =>
    `/agents/${agentId}?versionsPage=${versionsPage}&archivedCasesPage=${nextArchivedPage}&evaluationRunsPage=${nextRunsPage}#evaluation`;

  useEffect(() => {
    if (!isEvaluationRunning) return;
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [isEvaluationRunning, router]);

  function resetCaseForm() {
    setName("");
    setInputText('{"input":"请处理这条验收任务"}');
    setExpectedText("");
    setEditingId(null);
    setEditingUpdatedAt(null);
    setAdvancedExpectations([]);
  }

  function editCase(testCase: EvaluationCaseView) {
    setError(null);
    setNotice(null);
    setEditingId(testCase.id);
    setEditingUpdatedAt(testCase.updatedAt ?? testCase.createdAt);
    setName(testCase.name);
    setInputText(JSON.stringify(testCase.input));
    setExpectedText(commonExpectation(testCase.expectations));
    setAdvancedExpectations(testCase.expectations
      .filter((item) => !(item.path === "" && item.operator === "contains"))
      .map(advancedDraft));
  }

  async function saveCase() {
    setError(null);
    setNotice(null);
    let input: Record<string, unknown>;
    try {
      const parsed = JSON.parse(inputText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      input = parsed as Record<string, unknown>;
    } catch {
      setError("运行输入必须使用对象格式");
      return;
    }
    if (advancedExpectations.some((expectation) => !expectation.path.trim())) {
      setError("字段检查必须填写结果字段路径");
      return;
    }
    if (advancedExpectations.some((expectation) => expectation.operator === "contains" && !expectation.valueText.trim())) {
      setError("包含检查必须填写预期文字");
      return;
    }
    const parsedExpectations = advancedExpectations.map((expectation) => EvaluationExpectationSchema.safeParse(expectationFromDraft(expectation)));
    const invalidExpectation = parsedExpectations.find((result) => !result.success);
    if (invalidExpectation && !invalidExpectation.success) {
      setError(invalidExpectation.error.issues[0]?.message ?? "字段检查填写不正确");
      return;
    }
    const expectations = mergeCommonExpectation(
      parsedExpectations.flatMap((result) => result.success ? [result.data] : []),
      expectedText,
    );
    if (expectations.length > MAX_EVALUATION_EXPECTATIONS) {
      setError(`每个样例最多可以设置 ${MAX_EVALUATION_EXPECTATIONS} 项结果检查`);
      return;
    }
    setPending(true);
    try {
      const payload = {
        agentId,
        name,
        input,
        expectations,
      };
      const result = editingId
        ? await updateEvaluationCaseAction({ ...payload, caseId: editingId, expectedUpdatedAt: editingUpdatedAt })
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
    setNotice(null);
    try {
      const requestId = isEvaluationRunning
        ? undefined
        : evaluationRequestIdRef.current ?? crypto.randomUUID();
      if (requestId) evaluationRequestIdRef.current = requestId;
      const result = await startEvaluationAction(agentId, requestId);
      if (!result.ok) setError(result.error);
      else {
        evaluationRequestIdRef.current = null;
        router.refresh();
      }
    } catch {
      setError("启动自动验收失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  async function generateCases() {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await generateEvaluationCasesAction(agentId);
      if (!result.ok) setError(result.error);
      else {
        setNotice(result.reused
          ? `发布版本对应的 ${result.createdCount} 条样例已经存在，无需重复生成`
          : `已从发布版本生成 ${result.createdCount} 条可编辑样例`);
        router.refresh();
      }
    } catch {
      setError("生成验收样例失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  async function changeCaseState(caseId: string, archived: boolean) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setEvaluationCaseArchivedAction({ agentId, caseId, archived });
      if (!result.ok) setError(result.error);
      else router.refresh();
    } catch {
      setError(archived ? "归档验收样例失败，请稍后重试" : "恢复验收样例失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section id="evaluation" className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">自动验收</h2>
          <p className="mt-1 text-xs text-gray-500">优先验证待验收版本；全部通过后自动上线。没有待验收版本时验证当前版本。</p>
        </div>
        <button type="button" disabled={pending || cases.length === 0} onClick={startEvaluation}
          className="rounded-md bg-violet-700 px-3 py-2 text-sm text-white hover:bg-violet-600 disabled:bg-gray-300">
          {pending ? "正在处理…" : isEvaluationRunning ? "检查并继续" : "运行全部样例"}
        </button>
      </div>
      {isEvaluationRunning ? <p role="status" className="rounded-md bg-blue-50 p-2 text-sm text-blue-700">验收运行期间样例已锁定；若状态长时间不变化，可点“检查并继续”自动补启未完成样例。</p> : null}
      {error ? <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">{notice}</p> : null}
      {cases.length === 0 ? <div className="rounded-md border border-dashed border-gray-200 p-3">
        <p className="text-xs text-gray-500">可从最新发布版本生成类型正确的示例输入和最终交付字段检查，生成后再按真实业务调整内容。</p>
        <button type="button" disabled={pending || isEvaluationRunning} onClick={generateCases}
          className="mt-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:text-gray-400">从流程生成样例</button>
      </div> : null}
      <div className="grid gap-2 md:grid-cols-[1fr_2fr_1fr_auto]">
        <input aria-label="样例名称" disabled={isEvaluationRunning} value={name} onChange={(event) => setName(event.target.value)} placeholder="样例名称"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <input aria-label="运行输入" disabled={isEvaluationRunning} value={inputText} onChange={(event) => setInputText(event.target.value)} placeholder='{"input":"业务输入"}'
          className="rounded-md border border-gray-300 px-3 py-2 font-mono text-sm" />
        <input aria-label="结果应包含" disabled={isEvaluationRunning} value={expectedText} onChange={(event) => setExpectedText(event.target.value)} placeholder="可不填"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <button type="button" disabled={pending || isEvaluationRunning || !name.trim() || (!editingId && cases.length >= MAX_EVALUATION_CASES)} onClick={saveCase}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:text-gray-400">{editingId ? "保存修改" : "添加样例"}</button>
      </div>
      <p className="text-xs text-gray-500">请使用可重复的测试数据；输入中的密钥、令牌和密码会自动隐藏。</p>
      {cases.length >= MAX_EVALUATION_CASES ? <p className="text-xs text-amber-700">启用中的验收样例已达到 {MAX_EVALUATION_CASES} 条上限；归档不再使用的样例后可继续添加。</p> : null}
      <details className="rounded-md border border-gray-100 p-3">
        <summary className="cursor-pointer text-xs font-medium text-gray-600">字段检查（{advancedExpectations.length}）</summary>
        <p className="mt-2 text-xs text-gray-500">可检查结构化结果中的指定字段是否存在、等于或包含某个值。</p>
        {advancedExpectations.map((expectation, index) => (
          <div key={index} className="mt-2 grid gap-2 md:grid-cols-[1.5fr_120px_1.5fr_auto]">
            <input aria-label={`字段检查 ${index + 1} 路径`} disabled={isEvaluationRunning} value={expectation.path} placeholder="例如：deliverables.plan"
              onChange={(event) => setAdvancedExpectations((current) => current.map((item, position) => position === index ? { ...item, path: event.target.value } : item))}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            <select aria-label={`字段检查 ${index + 1} 方式`} disabled={isEvaluationRunning} value={expectation.operator}
              onChange={(event) => setAdvancedExpectations((current) => current.map((item, position) => position === index ? { ...item, operator: event.target.value as AdvancedExpectationDraft["operator"] } : item))}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <option value="exists">需要存在</option>
              <option value="equals">需要等于</option>
              <option value="contains">需要包含</option>
            </select>
            <input aria-label={`字段检查 ${index + 1} 预期值`} value={expectation.valueText} disabled={isEvaluationRunning || expectation.operator === "exists"}
              placeholder={expectation.operator === "equals" ? "文字、数字、true 或 JSON" : "需要包含的文字"}
              onChange={(event) => setAdvancedExpectations((current) => current.map((item, position) => position === index ? { ...item, valueText: event.target.value } : item))}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100" />
            <button type="button" disabled={pending || isEvaluationRunning} onClick={() => setAdvancedExpectations((current) => current.filter((_, position) => position !== index))}
              className="text-xs text-red-600 hover:underline">删除检查</button>
          </div>
        ))}
        <button type="button" disabled={pending || isEvaluationRunning || advancedExpectations.length >= MAX_EVALUATION_EXPECTATIONS - (expectedText.trim() ? 1 : 0)}
          onClick={() => setAdvancedExpectations((current) => [...current, { path: "", operator: "exists", valueText: "" }])}
          className="mt-3 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs disabled:text-gray-400">添加字段检查</button>
      </details>
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
                <button type="button" disabled={pending || isEvaluationRunning} onClick={() => editCase(testCase)} className="text-xs text-blue-700 hover:underline disabled:text-gray-400">编辑</button>
                <button type="button" disabled={pending || isEvaluationRunning} onClick={() => changeCaseState(testCase.id, true)} className="text-xs text-gray-500 hover:text-red-600 disabled:text-gray-400">归档</button>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-gray-500">还没有验收样例。</p>}
      {archivedCases.length > 0 || archivedPage > 1 ? (
        <details className="border-t border-gray-100 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-gray-600">已归档样例（第 {archivedPage} 页）</summary>
          <ul className="mt-2 divide-y divide-gray-100">
            {archivedCases.map((testCase) => (
              <li key={testCase.id} className="flex items-center justify-between gap-3 py-2 text-sm text-gray-500">
                <span>{testCase.name}</span>
                <button type="button" disabled={pending || isEvaluationRunning} onClick={() => changeCaseState(testCase.id, false)} className="text-xs text-blue-700 hover:underline disabled:text-gray-400">恢复</button>
              </li>
            ))}
          </ul>
          {archivedPage > 1 || hasMoreArchived ? (
            <nav aria-label="已归档样例分页" className="mt-3 flex items-center gap-3 text-xs">
              {archivedPage > 1 ? (
                <Link
                  href={detailHref(archivedPage - 1, runsPage)}
                  className="text-blue-700 hover:underline"
                >上一页</Link>
              ) : null}
              <span className="text-gray-500">第 {archivedPage} 页</span>
              {hasMoreArchived ? (
                <Link
                  href={detailHref(archivedPage + 1, runsPage)}
                  className="text-blue-700 hover:underline"
                >下一页</Link>
              ) : null}
            </nav>
          ) : null}
        </details>
      ) : null}
      {runs.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
          <h3 className="text-xs font-medium text-gray-600">验收记录</h3>
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
          {runsPage > 1 || hasMoreRuns ? (
            <nav aria-label="验收记录分页" className="flex items-center justify-between gap-3 pt-1 text-xs">
              {runsPage > 1 ? <Link href={detailHref(archivedPage, runsPage - 1)} className="text-blue-700 hover:underline">上一页</Link> : <span />}
              <span className="text-gray-500">第 {runsPage} 页</span>
              {hasMoreRuns ? <Link href={detailHref(archivedPage, runsPage + 1)} className="text-blue-700 hover:underline">下一页</Link> : <span />}
            </nav>
          ) : null}
        </div>
      ) : runsPage > 1 ? (
        <div className="border-t border-gray-100 pt-3">
          <p className="text-sm text-gray-500">这一页没有验收记录。</p>
          <Link href={detailHref(archivedPage, runsPage - 1)} className="mt-2 inline-block text-xs text-blue-700 hover:underline">返回上一页</Link>
        </div>
      ) : null}
    </section>
  );
}
