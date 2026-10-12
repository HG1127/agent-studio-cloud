"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { CheckCircle2, FileJson2, FileOutput, Play, Rocket, ShieldCheck } from "lucide-react";
import type { AgentInputField, AgentManifest } from "@/contracts/manifest";
import type { WorkflowVariable } from "@/contracts/workflow";
import { RunTaskStartInput } from "@/contracts/run-task";
import { RunResourceLimitNotice } from "@/features/runs/RunResourceLimitNotice";
import { inputFieldDescription } from "./input-field-description";
import { startRunTaskAction } from "@/server/actions/start-run-task";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { prepareRunLauncherInput, runLauncherFieldLabel as fieldLabel } from "./run-launcher-input";
import { StructuredInputEditor } from "@/features/inputs/StructuredInputEditor";
import { useStructuredInputSession } from "@/features/inputs/use-structured-input-session";
import { SectionReadState } from "@/components/ui/SectionReadState";

type RunLauncherProps = {
  agentId: string;
  productionVersionId: string | null;
  inputFields?: AgentInputField[];
  inputDefinitions?: WorkflowVariable[];
  outputFields?: NonNullable<AgentManifest["outputContract"]>["fields"];
  hasProductionVersion?: boolean;
  productionVersion?: number | null;
  sourceRefreshPolicy?: "follow" | "preserve-active";
  sourceUnavailable?: boolean;
};

type SourceProtection = "draft" | "pending" | "unknown" | "created";

export function RunLauncher(props: RunLauncherProps) {
  if (props.sourceRefreshPolicy === "preserve-active") return <PreservedRunLauncher key={props.agentId} {...props} />;
  return <RunLauncherSession key={JSON.stringify([props.agentId, props.productionVersionId])} {...props} />;
}

function PreservedRunLauncher(props: RunLauncherProps) {
  const [protection, setProtection] = useState<{ source: RunLauncherProps; state: SourceProtection } | null>(null);
  const protectionRef = useRef(protection);
  const latestSource = useRef(props);
  const mounted = useRef(false);
  const selected = protection ? { ...protection.source, productionVersion: props.productionVersionId === protection.source.productionVersionId ? props.productionVersion ?? protection.source.productionVersion : protection.source.productionVersion } : props;
  const sourceChanged = protection !== null && props.productionVersionId !== protection.source.productionVersionId;

  useLayoutEffect(() => { latestSource.current = props; });
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function protect(state: SourceProtection | null) {
    if (!mounted.current) return;
    const next = state ? { source: selected, state } : null;
    protectionRef.current = next;
    setProtection(next);
  }

  function changeSource() {
    const current = protectionRef.current;
    if (!mounted.current || !current || current.state === "pending" || latestSource.current.sourceUnavailable || latestSource.current.hasProductionVersion === false || !RunTaskStartInput.shape.versionId.unwrap().safeParse(latestSource.current.productionVersionId).success || latestSource.current.productionVersionId === current.source.productionVersionId) return;
    protectionRef.current = null;
    setProtection(null);
  }

  return <>
    {protection && sourceChanged ? <RunSourceChange key={JSON.stringify([selected.productionVersionId, props.productionVersionId, props.sourceUnavailable, props.hasProductionVersion])} state={protection.state} canChange={!props.sourceUnavailable && props.hasProductionVersion !== false && RunTaskStartInput.shape.versionId.unwrap().safeParse(props.productionVersionId).success} onConfirm={changeSource} /> : null}
    {protection && props.sourceUnavailable && !sourceChanged ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">{protection.state === "draft" ? "重新读取的业务字段暂时无法核对，本页仍保留原版本的本地填写，不改用默认输入；不会自动保存或提交新的任务。" : "重新读取的业务字段暂时无法核对，本页仍保留原请求与原填写，不改用默认输入。原请求结果仍以任务记录或人工核对为准。"}</p> : null}
    {selected.sourceUnavailable ? <SectionReadState id="run" title="试运行暂时无法读取" description="当前正式版本的业务字段无法读取，不能按默认表单启动任务。请重新读取并核对版本；其他已读取内容仍可查看。" /> : <RunLauncherSession key={JSON.stringify([selected.agentId, selected.productionVersionId])} {...selected} onProtectionChange={protect} />}
  </>;
}

function RunSourceChange({ state, canChange, onConfirm }: { state: SourceProtection; canChange: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <>
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      <p>{state === "draft" ? "当前版本来源已更新或暂时无法核对，本页仍保留原版本的本地填写，不会自动保存或提交任务。切换会清空未保存输入，请先核对新的正式版本。" : canChange ? "当前正式版本已更新，本页仍保留本次请求的原版本与完整填写。这里显示的是原请求使用的版本，不是后来发布的新版本；请先查看或核对原任务。" : "当前版本来源已变化或暂时无法核对，本页仍保留原请求与完整填写，不改用其他来源或默认输入。请先查看或核对原任务；新的正式版本就绪后再决定是否切换。"}</p>
      {canChange ? <button type="button" disabled={state === "pending"} onClick={() => { if (mounted.current && state !== "pending" && canChange) setOpen(true); }} className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">使用新版本填写</button> : null}
    </div>
    <ConfirmDialog open={open} onOpenChange={setOpen} title="改用新版本填写？" confirmLabel="确认改用新版本"
      description={state === "draft" ? "改用新版本会清空本页未保存的填写和导入草稿，之后需要重新填写。这次确认只切换本页填写，不会保存版本、启动或取消任务。" : state === "created" ? "原任务已确认创建。改用新版本会清空本页原填写，之后可另行启动新任务，不会撤销或替换原任务。" : "原请求仍需核对。改用新版本会清空本页原填写，之后启动会是另一条请求，可能产生额外任务；不会撤销原请求，请先核对运行记录。"}
      tone="warning" pending={state === "pending"} onConfirm={() => { if (mounted.current && state !== "pending" && canChange) onConfirm(); }} />
  </>;
}

function RunLauncherSession({ agentId, productionVersionId, inputFields, inputDefinitions = [], outputFields, hasProductionVersion = true, productionVersion, onProtectionChange }: RunLauncherProps & { onProtectionChange?: (state: SourceProtection | null) => void }) {
  const router = useRouter();
  const id = useId();
  const [inputText, setInputText] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [resourceLimit, setResourceLimit] = useState<unknown>(undefined);
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const runningRef = useRef(false);
  const requestRef = useRef<RunTaskStartInput | null>(null);
  const needsCheckRef = useRef(false);
  const confirmedCreated = useRef<string | null>(null);
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const pendingDraftError = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const structured = useStructuredInputSession(inputFields ?? [], () => runningRef.current || needsCheckRef.current || Boolean(confirmedCreated.current));
  const fieldValues = structured.values;
  const usesFieldForm = Boolean(inputFields?.length);

  useLayoutEffect(() => {
    mounted.current = true;
    lifecycle.current += 1;
    return () => { mounted.current = false; lifecycle.current += 1; };
  }, []);

  function updateField(name: string, value: string) {
    if (!structured.update(name, value)) return;
    onProtectionChange?.("draft");
    if (pendingDraftError.current && structured.firstPendingIndex() === null) { pendingDraftError.current = false; setError(null); }
  }

  function reportDraft(name: string, owner: string, revision: number, draftPending: boolean) {
    if (!mounted.current) return;
    structured.reportPending(name, owner, revision, draftPending);
    if (draftPending && !runningRef.current && !needsCheckRef.current && !confirmedCreated.current && structured.firstPendingIndex() !== null) onProtectionChange?.("draft");
    if (!draftPending && pendingDraftError.current && structured.firstPendingIndex() === null && !runningRef.current && !needsCheckRef.current && !confirmedCreated.current) { pendingDraftError.current = false; setError(null); }
  }

  async function handleRun() {
    if (runningRef.current || confirmedCreated.current || !mounted.current) return;
    setError(null);
    pendingDraftError.current = false;
    setResourceLimit(undefined);
    let request = requestRef.current;
    if (!request) {
      const draftIndex = structured.firstPendingIndex();
      if (draftIndex !== null) {
        pendingDraftError.current = true;
        setError(`${fieldLabel(inputFields![draftIndex], draftIndex)}还有尚未应用的填写。请确认应用或取消该项草稿；没有提交任务。`);
        form.current?.querySelector<HTMLElement>(`[data-run-field-index="${draftIndex}"]`)?.focus();
        return;
      }
      if (!hasProductionVersion || !RunTaskStartInput.shape.agentId.safeParse(agentId).success || !RunTaskStartInput.shape.versionId.unwrap().safeParse(productionVersionId).success) {
        setError("本页的助手或版本暂时无法核对，请重新读取版本；没有提交任务，完整填写仍保留。");
        return;
      }
      const prepared = prepareRunLauncherInput(inputFields, structured.valuesRef.current, inputText);
      if (!prepared.input) { setError(prepared.error); return; }
      try {
        const parsed = RunTaskStartInput.safeParse({ agentId, versionId: productionVersionId, input: prepared.input, requestId: crypto.randomUUID() });
        if (!parsed.success || !parsed.data.versionId) {
          setError("暂时无法按任务要求准备这次请求，请重新核对版本与填写；没有提交任务，完整填写仍保留。");
          return;
        }
        request = parsed.data;
      } catch {
        setError("暂时无法准备这次请求，请重新确认；没有提交任务，完整填写仍保留。");
        return;
      }
    }
    runningRef.current = true;
    requestRef.current = request;
    const checking = needsCheckRef.current;
    const generation = lifecycle.current;
    onProtectionChange?.("pending");
    setPending(true);
    try {
      const result = await startRunTaskAction(request);
      if (!mounted.current || lifecycle.current !== generation) return;
      if (result.ok) {
        confirmedCreated.current = result.runId;
        setCreatedRunId(result.runId);
        requestRef.current = null;
        needsCheckRef.current = false;
        setUncertain(false);
        setNewRequestOpen(false);
        onProtectionChange?.("created");
        router.push(`/runs/${result.runId}`);
      } else {
        setResourceLimit(result.resourceLimit);
        needsCheckRef.current = checking || result.retryable === true;
        if (!needsCheckRef.current) requestRef.current = null;
        setUncertain(needsCheckRef.current);
        onProtectionChange?.(needsCheckRef.current ? "unknown" : "draft");
        setError(checking ? `${result.error}。上次请求仍需核对，不能据此认定没有创建运行。` : result.error);
      }
    } catch {
      if (!mounted.current || lifecycle.current !== generation) return;
      if (confirmedCreated.current) {
        setError("已确认创建运行，请先查看这位助手的运行记录。");
        return;
      }
      needsCheckRef.current = true;
      setUncertain(true);
      onProtectionChange?.("unknown");
      setError("暂时无法确认是否已创建运行。请按原输入核对上次请求，或先查看该助手的运行记录。");
    } finally {
      if (mounted.current && lifecycle.current === generation) {
        runningRef.current = false;
        setPending(false);
      }
    }
  }

  return (
    <section id="run" aria-labelledby="run-launcher-title" className="content-card scroll-mt-32 overflow-hidden p-0 sm:p-0">
      <header className="flex flex-col gap-4 border-b border-slate-100 bg-gradient-to-br from-white to-indigo-50/70 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
            <Play aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="eyebrow">真实任务验证</p>
            <h2 id="run-launcher-title" className="mt-1 text-lg font-bold text-slate-950">试运行</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">提交一条业务输入，指定本页已读取的版本创建真实任务，执行证据与结果以任务详情为准。</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">指定版本是否可用由服务端核对，不会自动改用后来发布的新版本。创建记录不等于已执行、已完成或通过验收。</p>
          </div>
        </div>
        <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${hasProductionVersion ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          {hasProductionVersion ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : <Rocket aria-hidden="true" className="size-3.5" />}
          {hasProductionVersion ? (productionVersion !== null && productionVersion !== undefined ? `正式版本 V${productionVersion}` : "正式版本已就绪") : "尚无正式版本"}
        </span>
      </header>

      {!hasProductionVersion ? (
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Rocket aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-700" />
              <div>
                <h3 className="text-sm font-semibold text-amber-950">先发布一个正式版本</h3>
                <p className="mt-1 text-sm leading-6 text-amber-800">试运行只能使用已经冻结的正式版本，避免草稿变化影响执行证据。</p>
              </div>
            </div>
            <Link href="#versions" className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-amber-800 px-4 text-sm font-semibold text-white hover:bg-amber-900">前往版本发布</Link>
          </div>
        </div>
      ) : (
        <form ref={form} onSubmit={(event) => { event.preventDefault(); void handleRun(); }} className="p-5 sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              {usesFieldForm ? inputFields!.map((field, index) => {
                const description = inputFieldDescription(field, inputDefinitions);
                const hintId = description ? `${id}-description-${index}` : undefined;
                return <div key={field.name} className="space-y-1.5">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                  <span>{fieldLabel(field, index)}<span className="ml-1 text-xs font-normal text-slate-400">（{field.required ? "必填" : "选填"}）</span></span>
                  {field.type === "boolean" ? (
                    <select aria-describedby={hintId} value={fieldValues[field.name] ?? ""} disabled={pending || uncertain || Boolean(createdRunId)} onChange={(event) => updateField(field.name, event.target.value)}
                      className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">
                      <option value="">请选择</option><option value="true">是</option><option value="false">否</option>
                    </select>
                  ) : field.type === "object" || field.type === "array" ? (
                    <textarea data-run-field-index={index} aria-describedby={hintId} value={fieldValues[field.name] ?? ""} rows={4} placeholder={field.type === "array" ? "[]" : "{}"} disabled={pending || uncertain || Boolean(createdRunId)}
                      onChange={(event) => updateField(field.name, event.target.value)}
                      className="rounded-xl border border-slate-300 bg-white p-3 font-mono text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                  ) : (
                    field.type === "string" ? <textarea aria-describedby={hintId} rows={4} value={fieldValues[field.name] ?? ""} disabled={pending || uncertain || Boolean(createdRunId)}
                      onChange={(event) => updateField(field.name, event.target.value)}
                      className="rounded-xl border border-slate-300 bg-white p-3 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /> : <input aria-describedby={hintId} type="text" inputMode="decimal" value={fieldValues[field.name] ?? ""} disabled={pending || uncertain || Boolean(createdRunId)}
                      onChange={(event) => updateField(field.name, event.target.value)}
                      className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                  )}
                </label>
                {field.type === "object" || field.type === "array" ? <>
                  <p className="text-xs leading-5 text-slate-500">上方保留专业格式填写；也可在下方逐项编辑或导入。修改上方内容会替换该项尚未应用的本地草稿。</p>
                  <StructuredInputEditor field={field} label={fieldLabel(field, index)} value={fieldValues[field.name] ?? ""}
                    revision={structured.revisions[field.name] ?? 0} disabled={pending || uncertain || Boolean(createdRunId)}
                    onApply={(nextText, revision) => { const accepted = structured.apply(field.name, nextText, revision); if (accepted) { onProtectionChange?.("draft"); pendingDraftError.current = false; setError(null); } return accepted; }}
                    onPendingChange={(owner, revision, draftPending) => reportDraft(field.name, owner, revision, draftPending)} />
                </> : null}
                {description ? <p id={hintId} className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-500">{description}</p> : null}
                </div>;
              }) : (
                <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                  <span className="flex items-center gap-2"><FileJson2 aria-hidden="true" className="size-4 text-slate-400" />运行输入（对象格式）</span>
                  <textarea value={inputText} onChange={(event) => { if (mounted.current && !runningRef.current && !needsCheckRef.current && !confirmedCreated.current) { setInputText(event.target.value); onProtectionChange?.("draft"); } }} rows={6} disabled={pending || uncertain || Boolean(createdRunId)}
                    aria-label="运行输入（对象格式）" aria-describedby="run-json-help" className="rounded-xl border border-slate-300 bg-white p-3 font-mono text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                  <span id="run-json-help" className="text-xs font-normal leading-5 text-slate-500">请输入一个 JSON 对象；密钥、令牌和密码会在详情页自动隐藏。</span>
                </label>
              )}
              {structured.pendingCount > 0 ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">有 {structured.pendingCount} 项本地填写尚未应用。请逐项确认应用或取消，再开始试运行。</p> : null}
              {structured.applied ? <p aria-label="结构化填写状态" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">结构化内容已应用到当前填写，尚未提交任务或保存版本。</p> : null}
              {structured.draftError ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">{structured.draftError}</p> : null}
              {error ? (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <p>{error}</p>
                  <RunResourceLimitNotice resourceLimit={resourceLimit} />
                  {uncertain ? <Link href={`/runs?agent=${agentId}`} className="mt-2 inline-block font-semibold underline underline-offset-2">查看这位助手的运行记录</Link> : null}
                  {uncertain ? <button type="button" disabled={pending} onClick={() => setNewRequestOpen(true)} className="ml-3 mt-2 font-semibold underline underline-offset-2">改用新输入</button> : null}
                </div>
              ) : null}
            </div>

            <aside aria-label="本次运行说明" className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShieldCheck aria-hidden="true" className="size-4 text-indigo-600" />本次运行会</h3>
              <ul className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
                <li className="flex gap-2"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-indigo-500" />固定使用本页已读取的版本，不自动改用后来发布的新版本；能否运行由服务端核对。</li>
                <li className="flex gap-2"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-indigo-500" />需要人工确认时暂停，等待负责人决定。</li>
                <li className="flex gap-2"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-indigo-500" />保留输入、步骤、结果和确认记录供追溯。</li>
              </ul>
              {outputFields?.length ? <div className="mt-4 border-t border-slate-200 pt-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FileOutput aria-hidden="true" className="size-4 text-indigo-600" />完成后可查看与复制</h4>
                <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">
                  {outputFields.slice(0, 4).map((field, index) => <li key={field.path} className="break-words"><span>{field.label?.trim() || `交付内容 ${index + 1}`}</span>{!field.required ? <span className="ml-1 text-slate-500">（可选交付）</span> : null}</li>)}
                </ul>
                {outputFields.length > 4 ? <p className="mt-1 text-xs text-slate-500">另有 {outputFields.length - 4} 项交付内容</p> : null}
                <p className="mt-2 text-xs leading-5 text-slate-500">这里列的是版本约定；可选交付仅在来源有实际产出时提供。</p>
              </div> : null}
            </aside>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p id="run-safety-note" role={createdRunId ? "status" : undefined} className="text-xs leading-5 text-slate-500">{createdRunId ? "已创建真实运行记录，是否完成请以任务详情为准。本页不再重复提交，可手动打开本次任务。" : uncertain ? "核对会沿用上次提交的输入与请求标识；确认结果前不能修改本次输入。" : "提交后会创建一条新的运行记录，并自动打开详情页。"}</p>
            {createdRunId ? <Link href={`/runs/${createdRunId}`} prefetch={false} className="inline-flex h-11 items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white">打开本次任务详情</Link> : <button type="submit" disabled={pending} aria-describedby="run-safety-note" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300">
              <Play aria-hidden="true" className="size-4" />{pending ? (uncertain ? "正在核对上次请求…" : "正在创建运行记录…") : uncertain ? "核对上次启动" : "开始试运行"}
            </button>}
          </div>
        </form>
      )}
      <ConfirmDialog open={newRequestOpen} onOpenChange={setNewRequestOpen} title="开始另一条试运行？"
        description="上次请求的结果仍待确认。请先核对运行记录；改用新输入会开启另一条请求，可能产生额外任务，不会撤销上次提交。"
        confirmLabel="确认开始新请求" tone="warning" pending={pending}
        onConfirm={() => { if (runningRef.current || confirmedCreated.current || !needsCheckRef.current || !mounted.current) return; requestRef.current = null; needsCheckRef.current = false; onProtectionChange?.("draft"); setUncertain(false); setError(null); setResourceLimit(undefined); setNewRequestOpen(false); }} />
    </section>
  );
}
