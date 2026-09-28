"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, CheckCircle2, ChevronRight, CircleAlert, Clock3, FlaskConical, History, Pencil, Play, Plus, ShieldCheck, Sparkles, TestTube2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { AgentInputField } from "@/contracts/manifest";
import { EvaluationExpectation as EvaluationExpectationSchema, MAX_EVALUATION_CASES, MAX_EVALUATION_EXPECTATIONS, type EvaluationCaseCreateInput, type EvaluationCaseUpdateInput, type EvaluationCaseView, type EvaluationExpectation, type EvaluationRunView } from "@/contracts/evaluation";
import { evaluationFieldLabel, evaluationInputSummary, inputFitsFields, parseEvaluationFieldValues, valuesFromEvaluationInput } from "./evaluation-input-fields";
import { EvaluationInputPreview } from "./EvaluationInputPreview";
import { evaluationRequestRecoveryKey, PendingEvaluationRequest } from "@/features/quality/evaluation-request-recovery";
import { readSessionValue, removeSessionValue, writeSessionValue } from "@/lib/session-storage";
import {
  createEvaluationCaseAction,
  generateEvaluationCasesAction,
  startEvaluationAction,
  setEvaluationCaseArchivedAction,
  updateEvaluationCaseAction,
} from "@/server/actions/evaluations";

type AdvancedExpectationDraft = { path: string; operator: "equals" | "contains" | "exists"; valueText: string };
type CaseSaveRequest = { kind: "create"; payload: EvaluationCaseCreateInput } | { kind: "update"; payload: EvaluationCaseUpdateInput };

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

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
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
  hasEvaluableVersion = true,
  runsPage = 1,
  hasMoreRuns = false,
  inputFields,
  inputVersion,
  evaluationVersionId = null,
}: {
  agentId: string;
  cases: EvaluationCaseView[];
  archivedCases?: EvaluationCaseView[];
  runs: EvaluationRunView[];
  archivedPage?: number;
  hasMoreArchived?: boolean;
  versionsPage?: number;
  evaluationRunning?: boolean;
  hasEvaluableVersion?: boolean;
  runsPage?: number;
  hasMoreRuns?: boolean;
  inputFields?: AgentInputField[];
  inputVersion?: number | null;
  evaluationVersionId?: string | null;
}) {
  const [evaluationRequestId, setEvaluationRequestId] = useState<string | null>(null);
  const recoveryKey = evaluationRequestRecoveryKey(agentId);
  const [pendingEvaluationRequest, setPendingEvaluationRequest] = useState<PendingEvaluationRequest | null>(null);
  const [requestRecoveryLoaded, setRequestRecoveryLoaded] = useState(!evaluationVersionId);
  const [requestStorageUnavailable, setRequestStorageUnavailable] = useState(false);
  const [requestUnlockOpen, setRequestUnlockOpen] = useState(false);
  const router = useRouter();
  const [name, setName] = useState("");
  const [inputText, setInputText] = useState("{}");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [rawInputMode, setRawInputMode] = useState(false);
  const [legacyInputMismatch, setLegacyInputMismatch] = useState(false);
  const [inputVersionChanged, setInputVersionChanged] = useState(false);
  const previousInputSchema = useRef({ inputFields, inputVersion });
  const [expectedText, setExpectedText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null);
  const [advancedExpectations, setAdvancedExpectations] = useState<AdvancedExpectationDraft[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [caseToArchive, setCaseToArchive] = useState<EvaluationCaseView | null>(null);
  const [uncertainCaseSave, setUncertainCaseSave] = useState<CaseSaveRequest | null>(null);
  const isEvaluationRunning = Boolean(evaluationRunning || runs.some((run) => run.status === "running"));
  const requestVersionMismatch = Boolean(pendingEvaluationRequest && pendingEvaluationRequest.versionId !== evaluationVersionId);
  const canRunEvaluation = requestRecoveryLoaded && !requestVersionMismatch && cases.length > 0 && (hasEvaluableVersion || isEvaluationRunning || evaluationRequestId !== null);
  const latestRun = runs[0] ?? null;
  const usesFieldForm = Boolean(inputFields?.length) && !rawInputMode;
  const expectationCount = cases.reduce((count, testCase) => count + testCase.expectations.length, 0);
  const detailHref = (nextArchivedPage: number, nextRunsPage: number) =>
    `/agents/${agentId}?versionsPage=${versionsPage}&archivedCasesPage=${nextArchivedPage}&evaluationRunsPage=${nextRunsPage}#evaluation`;

  useEffect(() => {
    const raw = readSessionValue(recoveryKey);
    if (!raw) {
      queueMicrotask(() => setRequestRecoveryLoaded(true));
      return;
    }
    try {
      const parsed = PendingEvaluationRequest.parse(JSON.parse(raw));
      queueMicrotask(() => {
        setPendingEvaluationRequest(parsed);
        setEvaluationRequestId(parsed.requestId);
        setRequestRecoveryLoaded(true);
      });
    } catch {
      removeSessionValue(recoveryKey);
      queueMicrotask(() => setRequestRecoveryLoaded(true));
    }
  }, [recoveryKey]);

  useEffect(() => {
    const previous = previousInputSchema.current;
    previousInputSchema.current = { inputFields, inputVersion };
    if (previous.inputVersion === inputVersion || !previous.inputFields?.length) return;
    if (!editingId && !name.trim() && inputText === "{}" && Object.values(fieldValues).every((value) => !value.trim())) return;
    if (!rawInputMode) {
      const parsed = parseEvaluationFieldValues(previous.inputFields, fieldValues, false);
      const preserved = parsed.ok ? parsed.input : Object.fromEntries(Object.entries(fieldValues).filter(([, value]) => value.trim()));
      setInputText(JSON.stringify(preserved, null, 2));
      setRawInputMode(true);
    }
    setInputVersionChanged(true);
  }, [inputFields, inputVersion, editingId, name, inputText, fieldValues, rawInputMode]);

  useEffect(() => {
    if (!isEvaluationRunning) return;
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [isEvaluationRunning, router]);

  function resetCaseForm() {
    setName("");
    setInputText("{}");
    setFieldValues({});
    setRawInputMode(false);
    setLegacyInputMismatch(false);
    setInputVersionChanged(false);
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
    setFieldValues(inputFields ? valuesFromEvaluationInput(testCase.input, inputFields) : {});
    const mismatched = Boolean(inputFields?.length && !inputFitsFields(testCase.input, inputFields));
    setRawInputMode(mismatched);
    setLegacyInputMismatch(mismatched);
    setInputVersionChanged(false);
    setExpectedText(commonExpectation(testCase.expectations));
    setAdvancedExpectations(testCase.expectations
      .filter((item) => !(item.path === "" && item.operator === "contains"))
      .map(advancedDraft));
  }

  async function saveCase() {
    setError(null);
    setNotice(null);
    let request = uncertainCaseSave;
    if (!request) {
      let input: Record<string, unknown>;
      if (usesFieldForm && inputFields) {
        const parsed = parseEvaluationFieldValues(inputFields, fieldValues);
        if (!parsed.ok) {
          setError(parsed.error);
          return;
        }
        input = parsed.input;
      } else {
        try {
          const parsed = JSON.parse(inputText) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          input = parsed as Record<string, unknown>;
        } catch {
          setError("运行输入必须使用对象格式");
          return;
        }
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
      const payload = { agentId, name, input, expectations };
      if (editingId && !editingUpdatedAt) {
        setError("缺少样例版本信息，请刷新后重新编辑");
        return;
      }
      request = editingId
        ? { kind: "update", payload: { ...payload, caseId: editingId, expectedUpdatedAt: editingUpdatedAt! } }
        : { kind: "create", payload };
    }
    setPending(true);
    try {
      const result = request.kind === "update"
        ? await updateEvaluationCaseAction(request.payload)
        : await createEvaluationCaseAction(request.payload);
      if (!result.ok) {
        setUncertainCaseSave(null);
        setError(result.error);
      }
      else {
        setUncertainCaseSave(null);
        resetCaseForm();
        router.refresh();
      }
    } catch {
      setUncertainCaseSave(request);
      setError("暂时无法确认样例是否保存成功。核对会重用上次提交的内容；请保留本页，避免重复创建或覆盖修改。");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function startEvaluation() {
    if (pending || !canRunEvaluation) return;
    setPending(true);
    setError(null);
    setNotice(null);
    const requestId = pendingEvaluationRequest?.requestId
      ?? (isEvaluationRunning ? undefined : evaluationRequestId ?? crypto.randomUUID());
    const request = requestId && evaluationVersionId ? { requestId, versionId: evaluationVersionId } : null;
    if (requestId) setEvaluationRequestId(requestId);
    if (request) setRequestStorageUnavailable(!writeSessionValue(recoveryKey, JSON.stringify(request)));
    try {
      const result = await startEvaluationAction(agentId, requestId);
      if (result.ok) {
        removeSessionValue(recoveryKey);
        setEvaluationRequestId(null);
        setPendingEvaluationRequest(null);
        setRequestStorageUnavailable(false);
        router.refresh();
      } else if (result.error === "启动自动验收失败，请稍后重试" && request) {
        setPendingEvaluationRequest(request);
        setError("暂时无法确认验收是否已启动。核对会使用同一请求，不会重新创建另一轮验收。");
        router.refresh();
      } else {
        removeSessionValue(recoveryKey);
        setPendingEvaluationRequest(null);
        setEvaluationRequestId(null);
        setRequestStorageUnavailable(false);
        setError(result.error);
      }
    } catch {
      if (request) setPendingEvaluationRequest(request);
      setError("暂时无法确认验收是否已启动。核对会使用同一请求，不会重新创建另一轮验收。");
      router.refresh();
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
      setError("暂时无法确认样例是否生成成功。请先刷新查看样例列表，再决定是否重新生成。");
      router.refresh();
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
      setError(`暂时无法确认样例是否已${archived ? "归档" : "恢复"}。请先刷新核对列表，再决定是否重试。`);
      router.refresh();
    } finally {
      if (archived) setCaseToArchive(null);
      setPending(false);
    }
  }

  return (
    <section id="evaluation" className="scroll-mt-32 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/40">
      <header className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><FlaskConical className="size-5" /></span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-violet-600">发布门槛</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">自动验收</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">用可重复样例验证候选版本；全部通过后自动上线，没有候选版本时验证当前版本。</p>
          </div>
        </div>
        <Button type="button" size="lg" disabled={pending || uncertainCaseSave !== null || !canRunEvaluation} onClick={startEvaluation} className="bg-violet-600 hover:bg-violet-700">
          {isEvaluationRunning ? <Clock3 className="size-4" /> : <Play className="size-4" />}
          {pending ? "正在处理…" : isEvaluationRunning ? "检查并继续" : evaluationRequestId ? "核对上次验收" : "运行全部样例"}
        </Button>
      </header>

      <div className="grid border-y border-slate-100 bg-slate-50/70 sm:grid-cols-3">
        <div className="flex items-center gap-3 border-b border-slate-100 p-4 sm:border-b-0 sm:border-r">
          <span className="grid size-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><TestTube2 className="size-[18px]" /></span>
          <div><p className="text-xs text-slate-500">启用样例</p><p className="mt-0.5 font-semibold text-slate-900">{cases.length} 条</p></div>
        </div>
        <div className="flex items-center gap-3 border-b border-slate-100 p-4 sm:border-b-0 sm:border-r">
          <span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-600"><CheckCircle2 className="size-[18px]" /></span>
          <div><p className="text-xs text-slate-500">结果检查</p><p className="mt-0.5 font-semibold text-slate-900">{expectationCount} 项</p></div>
        </div>
        <div className="flex items-center gap-3 p-4">
          <span className={`grid size-9 place-items-center rounded-xl ${isEvaluationRunning ? "bg-blue-50 text-blue-600" : latestRun?.failedCount ? "bg-red-50 text-red-600" : latestRun ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
            {isEvaluationRunning ? <Clock3 className="size-[18px]" /> : latestRun?.failedCount ? <CircleAlert className="size-[18px]" /> : <CheckCircle2 className="size-[18px]" />}
          </span>
          <div><p className="text-xs text-slate-500">最近验收{latestRun ? ` · 版本 ${latestRun.version}` : ""}</p><p className="mt-0.5 font-semibold text-slate-900">{isEvaluationRunning ? "正在运行" : latestRun?.failedCount ? `${latestRun.failedCount} 项需处理` : latestRun ? "全部通过" : "尚未运行"}</p></div>
        </div>
      </div>

      <div className="space-y-3 px-5 pt-5">
        {pendingEvaluationRequest && !pending ? <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          <p className="font-semibold">上次验收结果待核对{requestVersionMismatch ? "，可验收版本已变化" : ""}</p>
          <p>{requestVersionMismatch ? "请先核对下方验收记录；不要用旧请求启动新版本。" : "请先核对下方验收记录；再次操作会沿用同一请求。"}</p>
          {requestStorageUnavailable ? <p>浏览器未能保留请求线索；请保持本页打开，先完成核对。</p> : null}
          <div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={() => router.refresh()} className="font-semibold underline underline-offset-2">重新读取验收状态</button><button type="button" onClick={() => setRequestUnlockOpen(true)} className="font-semibold underline underline-offset-2">已核对，继续操作</button></div>
        </div> : null}
        {!hasEvaluableVersion && !isEvaluationRunning ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">还没有可验收版本。可以先准备样例；要生成流程样例或运行验收，请到<Link href="#versions" className="mx-1 font-semibold underline underline-offset-2">版本发布</Link>保存并发布版本。</p> : null}
        {isEvaluationRunning ? <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-800">验收运行期间样例已锁定；若状态长时间不变化，可点“检查并继续”自动补启未完成样例。</p> : null}
        {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p> : null}
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-slate-900">验收样例</h3><p className="mt-1 text-xs leading-5 text-slate-500">把关键业务输入和预期结果保存为长期回归资产。</p></div>
            <Badge tone={cases.length > 0 ? "info" : "warning"}>{cases.length > 0 ? `${cases.length} 条已启用` : "需要准备样例"}</Badge>
          </div>

          {cases.length === 0 ? (
            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-indigo-600"><Sparkles className="size-4" /></span><div><p className="text-sm font-semibold text-slate-900">从已发布流程开始</p><p className="mt-1 text-xs leading-5 text-slate-500">系统会生成类型正确的输入与交付字段检查，生成后仍可按真实业务调整。</p></div></div>
              <Button type="button" variant="secondary" disabled={pending || uncertainCaseSave !== null || isEvaluationRunning || !hasEvaluableVersion} onClick={generateCases}><Sparkles className="size-4" />从流程生成样例</Button>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="mb-4 flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold text-slate-900">{editingId ? "编辑验收样例" : "添加验收样例"}</h4><p className="mt-1 text-xs text-slate-500">使用不含真实凭据、可重复运行的固定数据。</p></div>{editingId ? <Badge tone="info">正在编辑</Badge> : <Plus className="size-4 text-slate-400" />}</div>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-medium text-slate-600">样例名称
                <input aria-label="样例名称" disabled={isEvaluationRunning || pending} readOnly={uncertainCaseSave !== null} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：客户续约方案"
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100" />
              </label>
              <label className="grid gap-1.5 text-xs font-medium text-slate-600">结果应包含 <span className="font-normal text-slate-400">（可选）</span>
                <input aria-label="结果应包含" disabled={isEvaluationRunning || pending} readOnly={uncertainCaseSave !== null} value={expectedText} onChange={(event) => setExpectedText(event.target.value)} placeholder="例如：续约建议"
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100" />
              </label>
              <div className="lg:col-span-2">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-slate-600">运行输入{usesFieldForm && inputVersion ? ` · 版本 V${inputVersion} 的字段` : ""}</p>
                  {inputFields?.length && !uncertainCaseSave ? <button type="button" disabled={pending || isEvaluationRunning} onClick={() => {
                    setError(null);
                    if (usesFieldForm) {
                      const parsed = parseEvaluationFieldValues(inputFields, fieldValues, false);
                      if (!parsed.ok) { setError(parsed.error); return; }
                      setInputText(JSON.stringify(parsed.input, null, 2));
                      setRawInputMode(true);
                    } else {
                      try {
                        const input = JSON.parse(inputText) as unknown;
                        if (!input || typeof input !== "object" || Array.isArray(input) || !inputFitsFields(input as Record<string, unknown>, inputFields)) throw new Error();
                        setFieldValues(valuesFromEvaluationInput(input as Record<string, unknown>, inputFields));
                        setRawInputMode(false);
                        setLegacyInputMismatch(false);
                        setInputVersionChanged(false);
                      } catch { setError("现有输入与当前版本的字段不一致，请保留对象格式编辑，避免丢失内容。"); }
                    }
                  }} className="text-xs font-semibold text-indigo-700 hover:underline disabled:text-slate-400">{usesFieldForm ? "使用对象格式" : "按版本字段填写"}</button> : null}
                </div>
                {inputVersionChanged ? <p role="status" className="mb-2 text-xs leading-5 text-amber-700">验收版本的输入字段已变化。已保留你填写的内容；请按当前版本核对后再保存。</p> : null}
                {usesFieldForm && inputFields ? <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
                  {inputFields.map((field, index) => <label key={field.name} className={`grid min-w-0 gap-1.5 text-xs font-medium text-slate-600 ${field.type === "object" || field.type === "array" ? "sm:col-span-2" : ""}`}>
                    <span>{evaluationFieldLabel(field, index)} <span className="font-normal text-slate-400">（{field.required ? "必填" : "选填"}）</span></span>
                    {field.type === "boolean" ? <select aria-label={evaluationFieldLabel(field, index)} disabled={isEvaluationRunning || pending || uncertainCaseSave !== null} value={fieldValues[field.name] ?? ""}
                      onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.value }))} className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>
                      : field.type === "object" || field.type === "array" ? <textarea aria-label={evaluationFieldLabel(field, index)} rows={3} disabled={isEvaluationRunning || pending} readOnly={uncertainCaseSave !== null} value={fieldValues[field.name] ?? ""}
                        onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.value }))} placeholder={field.type === "array" ? "[]" : "{}"} className="min-w-0 rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900" />
                        : <input aria-label={evaluationFieldLabel(field, index)} type={field.type === "number" ? "number" : "text"} disabled={isEvaluationRunning || pending} readOnly={uncertainCaseSave !== null} value={fieldValues[field.name] ?? ""}
                          onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.value }))} className="h-10 min-w-0 rounded-lg border border-slate-200 px-3 text-sm text-slate-900" />}
                  </label>)}
                </div> : <div>
                  {legacyInputMismatch ? <p className="mb-2 text-xs leading-5 text-amber-700">这条旧样例的输入与当前版本字段不同，已保留全部原始内容供编辑。</p> : null}
                  <textarea aria-label="运行输入" rows={3} disabled={isEvaluationRunning || pending} readOnly={uncertainCaseSave !== null} value={inputText} onChange={(event) => { setInputText(event.target.value); if (!inputFields?.length) setRawInputMode(true); }} placeholder='{"业务输入":"填写可重复测试的内容"}'
                    className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm leading-6 text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100" />
                </div>}
              </div>
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />请使用可重复的测试数据；输入中的密钥、令牌和密码会自动隐藏。</p>
            {cases.length >= MAX_EVALUATION_CASES ? <p className="mt-2 text-xs text-amber-700">启用中的验收样例已达到 {MAX_EVALUATION_CASES} 条上限；归档不再使用的样例后可继续添加。</p> : null}

            <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">字段检查（{advancedExpectations.length}）</summary>
              <p className="mt-2 text-xs leading-5 text-slate-500">检查结构化结果中的指定字段是否存在、等于或包含某个值。</p>
              {advancedExpectations.map((expectation, index) => (
                <div key={index} className="mt-3 grid min-w-0 gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-2 sm:grid-cols-2">
                  <label className="grid min-w-0 gap-1 text-xs text-slate-600">检查字段<input aria-label={`字段检查 ${index + 1} 路径`} disabled={isEvaluationRunning || pending} readOnly={uncertainCaseSave !== null} value={expectation.path} placeholder="例如：deliverables.plan"
                    onChange={(event) => setAdvancedExpectations((current) => current.map((item, position) => position === index ? { ...item, path: event.target.value } : item))}
                    className="h-9 w-full min-w-0 rounded-lg border border-slate-200 px-2.5 text-sm outline-none focus:border-indigo-400" /></label>
                  <label className="grid min-w-0 gap-1 text-xs text-slate-600">检查方式<select aria-label={`字段检查 ${index + 1} 方式`} disabled={isEvaluationRunning || pending || uncertainCaseSave !== null} value={expectation.operator}
                    onChange={(event) => setAdvancedExpectations((current) => current.map((item, position) => position === index ? { ...item, operator: event.target.value as AdvancedExpectationDraft["operator"] } : item))}
                    className="h-9 w-full min-w-0 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-indigo-400">
                    <option value="exists">需要存在</option><option value="equals">需要等于</option><option value="contains">需要包含</option>
                  </select></label>
                  <label className="grid min-w-0 gap-1 text-xs text-slate-600">预期值<input aria-label={`字段检查 ${index + 1} 预期值`} value={expectation.valueText} disabled={isEvaluationRunning || pending || expectation.operator === "exists"} readOnly={uncertainCaseSave !== null}
                    placeholder={expectation.operator === "equals" ? "文字、数字、true 或 JSON" : "需要包含的文字"}
                    onChange={(event) => setAdvancedExpectations((current) => current.map((item, position) => position === index ? { ...item, valueText: event.target.value } : item))}
                    className="h-9 w-full min-w-0 rounded-lg border border-slate-200 px-2.5 text-sm outline-none focus:border-indigo-400 disabled:bg-slate-100" /></label>
                  <button type="button" disabled={pending || isEvaluationRunning || uncertainCaseSave !== null} onClick={() => setAdvancedExpectations((current) => current.filter((_, position) => position !== index))} className="min-h-9 justify-self-end rounded-lg px-2 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-800 disabled:text-slate-400">删除检查</button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" disabled={pending || isEvaluationRunning || uncertainCaseSave !== null || advancedExpectations.length >= MAX_EVALUATION_EXPECTATIONS - (expectedText.trim() ? 1 : 0)} onClick={() => setAdvancedExpectations((current) => [...current, { path: "", operator: "exists", valueText: "" }])} className="mt-3"><Plus className="size-3.5" />添加字段检查</Button>
            </details>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {editingId ? <Button type="button" variant="ghost" disabled={pending || uncertainCaseSave !== null} onClick={resetCaseForm}>取消编辑</Button> : null}
              <Button type="button" disabled={pending || isEvaluationRunning || (!uncertainCaseSave && (!name.trim() || (!editingId && cases.length >= MAX_EVALUATION_CASES)))} onClick={saveCase}>{editingId ? <Pencil className="size-4" /> : <Plus className="size-4" />}{uncertainCaseSave ? "核对上次保存" : editingId ? "保存修改" : "添加样例"}</Button>
            </div>
          </div>

          {cases.length > 0 ? (
            <ul className="grid gap-2">
              {cases.map((testCase) => (
                <li key={testCase.id} aria-label={`验收样例：${testCase.name}`} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-1 gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><TestTube2 className="size-4" /></span><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-slate-900">{testCase.name}</p><p className="mt-1 break-words text-xs leading-5 text-slate-600">{evaluationInputSummary(testCase.input, inputFields)}</p><p className="mt-1 text-xs text-slate-500">{testCase.expectations.length > 0 ? `${testCase.expectations.length} 项结果检查` : "只检查流程是否成功完成"}</p></div></div>
                    <span className="flex shrink-0 self-end gap-1 sm:self-auto">
                      <Button type="button" aria-label="编辑" variant="ghost" size="sm" disabled={pending || uncertainCaseSave !== null || isEvaluationRunning} onClick={() => editCase(testCase)}><Pencil className="size-3.5" />编辑</Button>
                      <Button type="button" aria-label="归档" variant="ghost" size="sm" disabled={pending || uncertainCaseSave !== null || isEvaluationRunning} onClick={() => setCaseToArchive(testCase)} className="hover:bg-red-50 hover:text-red-700"><Archive className="size-3.5" />归档</Button>
                    </span>
                  </div>
                  <details className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
                    <summary className="cursor-pointer font-medium text-slate-600">查看样例内容</summary>
                    <EvaluationInputPreview input={testCase.input} fields={inputFields} />
                    {testCase.expectations.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-4">{testCase.expectations.map((expectation, index) => <li key={index}>{expectationLabel(expectation)}</li>)}</ul> : <p className="mt-2">只检查流程是否成功完成</p>}
                  </details>
                </li>
              ))}
            </ul>
          ) : <p className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">还没有验收样例。</p>}

          {archivedCases.length > 0 || archivedPage > 1 ? (
            <details className="rounded-xl border border-slate-200 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">已归档样例（第 {archivedPage} 页）</summary>
              <ul className="mt-2 divide-y divide-slate-100">{archivedCases.map((testCase) => <li key={testCase.id} className="flex items-center justify-between gap-3 py-2 text-sm text-slate-500"><span>{testCase.name}</span><Button type="button" variant="ghost" size="sm" disabled={pending || uncertainCaseSave !== null || isEvaluationRunning} onClick={() => changeCaseState(testCase.id, false)}>恢复</Button></li>)}</ul>
              {archivedPage > 1 || hasMoreArchived ? <nav aria-label="已归档样例分页" className="mt-3 flex items-center gap-3 text-xs">{archivedPage > 1 ? <Link href={detailHref(archivedPage - 1, runsPage)} className="font-medium text-indigo-600 hover:text-indigo-800">上一页</Link> : null}<span className="text-slate-500">第 {archivedPage} 页</span>{hasMoreArchived ? <Link href={detailHref(archivedPage + 1, runsPage)} className="font-medium text-indigo-600 hover:text-indigo-800">下一页</Link> : null}</nav> : null}
            </details>
          ) : null}
        </div>

        <aside className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-4" aria-labelledby="evaluation-history-title">
          <div className="flex items-start justify-between gap-3"><div><h3 id="evaluation-history-title" className="text-sm font-semibold text-slate-900">验收记录</h3><p className="mt-1 text-xs leading-5 text-slate-500">逐轮保留版本、通过情况与每条运行证据。</p></div><History className="size-4 text-slate-400" /></div>
          {runs.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {runs.map((run) => {
                const completeCount = run.passedCount + run.failedCount;
                const progress = run.totalCount > 0 ? Math.min(100, Math.round((completeCount / run.totalCount) * 100)) : 0;
                return <article key={run.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-slate-900">版本 {run.version}</p><p className="mt-1 text-xs text-slate-500">{formatTime(run.startedAt)}</p></div><Badge tone={run.status === "running" ? "info" : run.failedCount > 0 ? "danger" : "success"}>{run.status === "running" ? "运行中" : run.failedCount > 0 ? "未通过" : "已通过"}</Badge></div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${run.failedCount > 0 ? "bg-red-500" : run.status === "running" ? "bg-blue-500" : "bg-emerald-500"}`} style={{ width: `${progress}%` }} /></div>
                  <p className="mt-2 text-xs text-slate-500">通过 {run.passedCount} / 失败 {run.failedCount} / 共 {run.totalCount}</p>
                  {run.results.length > 0 ? <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">{run.results.map((result) => <li key={result.caseId} className="rounded-lg bg-slate-50 p-2 text-xs"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><span className={result.status === "failed" ? "font-medium text-red-700" : result.status === "passed" ? "font-medium text-emerald-700" : "font-medium text-blue-700"}>{result.caseName}：{result.status === "failed" ? "未通过" : result.status === "passed" ? "通过" : "运行中"}</span>{result.error ? <p className="mt-1 break-words leading-5 text-red-600">{result.error}</p> : null}</div>{result.runId ? <Link href={`/runs/${result.runId}`} className="inline-flex shrink-0 items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800">查看运行<ChevronRight className="size-3" /></Link> : null}</div></li>)}</ul> : null}
                </article>;
              })}
              {runsPage > 1 || hasMoreRuns ? <nav aria-label="验收记录分页" className="flex items-center justify-between gap-3 pt-1 text-xs">{runsPage > 1 ? <Link href={detailHref(archivedPage, runsPage - 1)} className="font-medium text-indigo-600 hover:text-indigo-800">上一页</Link> : <span />}<span className="text-slate-500">第 {runsPage} 页</span>{hasMoreRuns ? <Link href={detailHref(archivedPage, runsPage + 1)} className="font-medium text-indigo-600 hover:text-indigo-800">下一页</Link> : <span />}</nav> : null}
            </div>
          ) : runsPage > 1 ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-4"><p className="text-sm text-slate-500">这一页没有验收记录。</p><Link href={detailHref(archivedPage, runsPage - 1)} className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-800">返回上一页</Link></div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center"><Clock3 className="mx-auto size-5 text-slate-400" /><p className="mt-3 text-sm font-medium text-slate-700">还没有验收记录</p><p className="mt-1 text-xs leading-5 text-slate-500">准备样例后运行一次验收，结果与逐项证据会显示在这里。</p></div>
          )}
        </aside>
      </div>
      <ConfirmDialog open={Boolean(caseToArchive)} onOpenChange={(open) => { if (!open) setCaseToArchive(null); }}
        title={`归档「${caseToArchive?.name ?? "验收样例"}」？`}
        description="归档后，这条样例不再参与后续自动验收；已有验收记录仍保留，也可以从已归档样例中恢复。"
        confirmLabel="归档样例" pending={pending} onConfirm={() => { if (caseToArchive) void changeCaseState(caseToArchive.id, true); }} />
      <ConfirmDialog open={requestUnlockOpen} onOpenChange={setRequestUnlockOpen}
        title="已经核对上次验收？"
        description="上次验收可能已经运行。请确认下方记录与当前版本状态后，再放弃原请求并发起新的验收。"
        confirmLabel="继续操作" tone="warning" onConfirm={() => {
          removeSessionValue(recoveryKey);
          setPendingEvaluationRequest(null);
          setEvaluationRequestId(null);
          setRequestStorageUnavailable(false);
          setRequestUnlockOpen(false);
        }} />
    </section>
  );
}
