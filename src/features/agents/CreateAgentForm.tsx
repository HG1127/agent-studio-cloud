"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  Database,
  FileOutput,
  Lightbulb,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { createAgentAction } from "@/server/actions/create-agent";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notifyDraftState } from "@/lib/draft-state";
import { readSessionValue, removeSessionValue, writeSessionValue } from "@/lib/session-storage";
import {
  AGENT_BLUEPRINT_DRAFT_KEY,
  MAX_AGENT_INTENT_LENGTH,
  composeAgentBlueprintIntent,
  restoreAgentBlueprintDraft,
  serializeAgentBlueprintDraft,
} from "./agent-blueprint";
import {
  AGENT_CREATE_REQUEST_KEY,
  restoreAgentCreateRequest,
  serializeAgentCreateRequest,
  type AgentCreateRequest,
} from "./agent-create-request";

const INTENT_PLACEHOLDER =
  "收到客户咨询后读取客户资料并生成回复方案，发送前由负责人确认，最后输出回复邮件";

const EXAMPLE_INTENTS = [
  "收到客户投诉后，整理问题和客户资料，拟定回复方案并交由负责人确认",
  "每天汇总销售数据，找出异常变化，生成一份带结论的经营简报",
  "收到合同后检查关键条款和风险点，输出审核清单供法务确认",
];

const FIELD_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";

export function CreateAgentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [intentText, setIntentText] = useState("");
  const [trigger, setTrigger] = useState("");
  const [inputs, setInputs] = useState("");
  const [outputs, setOutputs] = useState("");
  const [constraints, setConstraints] = useState("");
  const [pending, setPending] = useState(false);
  const submittingRef = useRef(false);
  const requestRef = useRef<AgentCreateRequest | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [requestStorageUnavailable, setRequestStorageUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false);
  const dirty = [name, intentText, trigger, inputs, outputs, constraints].some((value) => value.trim());
  const hasDraft = Boolean(dirty || uncertain);
  const blueprintItems = [trigger, inputs, outputs, constraints].filter((value) => value.trim()).length;
  const completeIntent = composeAgentBlueprintIntent({ objective: intentText, trigger, inputs, outputs, constraints });
  const intentTooLong = completeIntent.length > MAX_AGENT_INTENT_LENGTH;
  const coreReady = Boolean(name.trim() && intentText.trim().length >= 10 && !intentTooLong);

  useEffect(() => {
    const raw = readSessionValue(AGENT_BLUEPRINT_DRAFT_KEY);
    const recovered = restoreAgentBlueprintDraft(raw);
    if (!recovered && raw) removeSessionValue(AGENT_BLUEPRINT_DRAFT_KEY);
    const rawRequest = readSessionValue(AGENT_CREATE_REQUEST_KEY);
    const recoveredRequest = restoreAgentCreateRequest(rawRequest);
    if (!recoveredRequest && rawRequest) removeSessionValue(AGENT_CREATE_REQUEST_KEY);
    if (!recovered && !recoveredRequest) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (recovered) {
        setName(recovered.name);
        setIntentText(recovered.objective);
        setTrigger(recovered.trigger);
        setInputs(recovered.inputs);
        setOutputs(recovered.outputs);
        setConstraints(recovered.constraints);
      }
      if (recoveredRequest) {
        requestRef.current = recoveredRequest;
        if (!recovered) {
          setName(recoveredRequest.name);
          setIntentText(recoveredRequest.intentText);
        }
        setUncertain(true);
        setNotice("已恢复上次创建请求；结果待核对，核对前不能修改本次内容。");
      } else {
        setNotice("已恢复本标签页中未提交的业务蓝图");
      }
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) {
      removeSessionValue(AGENT_BLUEPRINT_DRAFT_KEY);
      return;
    }
    writeSessionValue(AGENT_BLUEPRINT_DRAFT_KEY, serializeAgentBlueprintDraft({
      name,
      objective: intentText,
      trigger,
      inputs,
      outputs,
      constraints,
    }));
  }, [constraints, dirty, inputs, intentText, name, outputs, trigger]);
  useEffect(() => notifyDraftState({ agentId: "create-agent", dirty: hasDraft }), [hasDraft]);
  useEffect(() => () => notifyDraftState({ agentId: "create-agent", dirty: false }), []);
  useEffect(() => {
    if (!hasDraft) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [hasDraft]);

  function clearDraft() {
    setName("");
    setIntentText("");
    setTrigger("");
    setInputs("");
    setOutputs("");
    setConstraints("");
    setError(null);
    setNotice(null);
    setClearConfirmOpen(false);
    requestRef.current = null;
    setUncertain(false);
    setRequestStorageUnavailable(false);
    removeSessionValue(AGENT_CREATE_REQUEST_KEY);
    removeSessionValue(AGENT_BLUEPRINT_DRAFT_KEY);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    setError(null);
    setNotice(null);
    let request: AgentCreateRequest;
    if (uncertain) {
      if (!requestRef.current) {
        setError("无法读取上次创建请求，请先返回助手列表核对。");
        return;
      }
      request = requestRef.current;
    } else {
      if (intentTooLong) {
        setError(`完整工作说明不能超过 ${MAX_AGENT_INTENT_LENGTH} 个字，请精简后重试`);
        return;
      }
      request = { name, intentText: completeIntent, requestId: crypto.randomUUID() };
      requestRef.current = request;
      if (!writeSessionValue(AGENT_CREATE_REQUEST_KEY, serializeAgentCreateRequest(request))) {
        setRequestStorageUnavailable(true);
      }
    }
    submittingRef.current = true;
    setPending(true);
    try {
      const result = await createAgentAction({ name: request.name, intentText: request.intentText }, request.requestId);
      if (result.ok) {
        clearDraft();
        router.push(`/agents/${result.agentId}`);
        return;
      }
      setUncertain(true);
      setError(result.error);
    } catch {
      setUncertain(true);
      setError("暂时无法确认助手是否已创建。请沿用上次请求核对，或先查看助手列表。");
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate={uncertain} className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-indigo-600 text-sm font-bold text-white">1</span>
            <div>
              <h3 className="font-semibold text-slate-950">先给这位助手一个清楚的任务</h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">像给新同事交代工作一样，说明场景、处理动作和期望结果。</p>
            </div>
          </div>

          <div className="grid gap-5">
            <div className="grid gap-2">
              <span className="flex items-center justify-between gap-3"><label htmlFor="agent-name" className="text-sm font-semibold text-slate-800">助手名称</label><span aria-hidden="true" className="text-xs text-slate-400">{name.length}/60</span></span>
              <input
                id="agent-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                required
                disabled={pending || uncertain}
                placeholder="例如：客户投诉处理助手"
                className={FIELD_CLASS}
              />
            </div>
            <div className="grid gap-2">
              <span className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="agent-intent" className="text-sm font-semibold text-slate-800">想让助手完成什么（至少 10 个字）</label><span aria-hidden="true" className="text-xs text-slate-400">{intentText.length}/2000</span></span>
              <textarea
                id="agent-intent"
                value={intentText}
                onChange={(event) => setIntentText(event.target.value)}
                rows={5}
                minLength={10}
                maxLength={2000}
                required
                disabled={pending || uncertain}
                placeholder={INTENT_PLACEHOLDER}
                className={`${FIELD_CLASS} min-h-36 resize-y leading-6`}
              />
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-3.5">
            <p className="flex items-center gap-2 text-xs font-semibold text-slate-600"><Lightbulb className="size-4 text-amber-500" />不知道怎么写？可从这些例子开始</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLE_INTENTS.map((example, index) => (
                <button key={example} type="button" disabled={pending || uncertain} onClick={() => setIntentText(example)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs leading-5 text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                  示例 {index + 1}：{example}
                </button>
              ))}
            </div>
          </div>
        </section>

        <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-sm font-bold text-white">2</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 font-semibold text-slate-950">补充业务蓝图（推荐）<span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">可选</span></span>
              <span className="mt-1 block text-sm font-normal leading-6 text-slate-500">把开始条件、资料、交付和限制说清楚，生成的流程会更贴近实际工作。</span>
            </span>
            <span className="text-sm font-medium text-indigo-600 group-open:hidden">展开</span>
            <span className="hidden text-sm font-medium text-indigo-600 group-open:inline">收起</span>
          </summary>
          <div className="border-t border-slate-100 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <BlueprintField icon={Clock3} label="什么时候开始" value={trigger} onChange={setTrigger}
                maxLength={300} disabled={pending || uncertain} placeholder="例如：收到新的售后工单后" />
              <BlueprintField icon={Database} label="需要哪些资料" value={inputs} onChange={setInputs}
                maxLength={500} disabled={pending || uncertain} placeholder="例如：工单内容、客户等级、商品信息" />
              <BlueprintField icon={FileOutput} label="最终要交付什么" value={outputs} onChange={setOutputs}
                maxLength={500} disabled={pending || uncertain} placeholder="例如：回复邮件和处理记录" />
              <BlueprintField icon={ShieldCheck} label="有哪些限制" value={constraints} onChange={setConstraints}
                maxLength={500} disabled={pending || uncertain} placeholder="例如：发送前必须由负责人确认" />
            </div>
          </div>
        </details>

        <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-semibold text-slate-800">
            <span>核对完整工作说明</span>
            <span className={`text-xs ${intentTooLong ? "text-red-700" : "text-slate-500"}`}>{completeIntent.length}/{MAX_AGENT_INTENT_LENGTH} 字</span>
          </summary>
          <p className="mt-3 text-xs leading-5 text-slate-500">创建时会把工作目标和补充信息合在一起使用；这里展示的是你的说明，不是已生成的流程。</p>
          <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">{completeIntent || "填写工作目标后可在这里核对完整说明。"}</pre>
        </details>
        {intentTooLong && !uncertain ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">完整工作说明超出 {completeIntent.length - MAX_AGENT_INTENT_LENGTH} 个字，请缩短工作目标或补充信息后再创建。</p> : null}

        {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700"><CircleHelp className="mt-0.5 size-4 shrink-0" /><div><p>{error}</p>{uncertain ? <Link href="/agents" className="mt-1 inline-block font-semibold underline underline-offset-2">先查看助手列表</Link> : null}</div></div> : null}
        {notice ? <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700"><Check className="mt-0.5 size-4 shrink-0" />{notice}</div> : null}

        {uncertain ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <p className="font-semibold">上次创建结果待核对</p>
          <p className="mt-1">核对会沿用同一份工作目标和同一个请求，不会另起一位助手。核对前先不要修改本次内容。</p>
          {requestStorageUnavailable ? <p className="mt-1 font-medium">浏览器未能保留本次请求；请保持此页面打开，并在离开前完成核对。</p> : null}
        </div> : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {uncertain ? <button type="button" disabled={pending} onClick={() => setUnlockConfirmOpen(true)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium text-amber-800 transition hover:bg-amber-50 disabled:text-slate-300">放弃核对并继续修改</button>
            : dirty ? <button type="button" disabled={pending} onClick={() => setClearConfirmOpen(true)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-700 disabled:text-slate-300"><RotateCcw className="size-4" />清空内容</button> : <span />}
          <button type="submit" disabled={pending || (!uncertain && intentTooLong)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-300">
            {pending ? <><Sparkles className="size-4 animate-pulse" />{uncertain ? "正在核对上次创建…" : "正在生成流程草稿…"}</> : <>{uncertain ? "核对上次创建" : "创建助手"}<ArrowRight className="size-4" /></>}
          </button>
        </div>
      </div>

      <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5 xl:sticky xl:top-24">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Target className="size-4 text-indigo-600" />创建准备</div>
        <div className="mt-4 space-y-3">
          <ReadinessItem ready={Boolean(name.trim())} title="给助手命名" detail={name.trim() || "用工作名称，团队更容易找到"} />
          <ReadinessItem ready={intentText.trim().length >= 10} title="说清工作目标" detail={intentText.trim().length >= 10 ? "目标描述已经可以生成流程" : "至少填写 10 个字"} />
          <ReadinessItem ready={blueprintItems > 0} optional title="补充业务蓝图" detail={blueprintItems ? `已补充 ${blueprintItems} 项业务信息` : "可选，之后仍可在画布调整"} />
        </div>
        <div className={`mt-5 rounded-xl border p-3.5 ${coreReady ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
          <p className={`text-sm font-semibold ${coreReady ? "text-emerald-800" : "text-slate-700"}`}>{uncertain ? "先核对上次创建" : intentTooLong ? "完整说明过长，暂不能创建" : coreReady ? "已经可以创建" : "完成前两项即可创建"}</p>
          <p className={`mt-1 text-xs leading-5 ${coreReady ? "text-emerald-700" : "text-slate-500"}`}>{uncertain ? "结果尚未确认；核对沿用原请求和原内容。" : intentTooLong ? "请精简工作目标或补充信息，直到完整说明不超过上限。" : "创建后会得到一份可编辑的流程草稿，不会直接发布或开始运行。"}</p>
        </div>
      </aside>
      <ConfirmDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen} title="清空当前内容？"
        description="助手名称、工作目标和已补充的业务蓝图都会被清空，这些内容还没有提交，清空后无法恢复。"
        confirmLabel="确认清空" onConfirm={clearDraft} />
      <ConfirmDialog open={unlockConfirmOpen} onOpenChange={setUnlockConfirmOpen} title="放弃核对上次创建？"
        description="上次请求可能已经创建了助手。继续修改并再次提交会作为新的创建请求，可能产生另一位助手。建议先查看助手列表。"
        confirmLabel="继续修改" tone="warning" onConfirm={() => {
          requestRef.current = null;
          setUncertain(false);
          setRequestStorageUnavailable(false);
          setError(null);
          setNotice("已停止核对上次请求；再次提交会创建新的助手。");
          setUnlockConfirmOpen(false);
          removeSessionValue(AGENT_CREATE_REQUEST_KEY);
        }} />
    </form>
  );
}

function BlueprintField({ icon: Icon, label, value, onChange, maxLength, disabled, placeholder }: {
  icon: typeof Clock3;
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  disabled: boolean;
  placeholder: string;
}) {
  return <label className="grid gap-2 text-sm font-semibold text-slate-800">
    <span className="flex items-center gap-2"><Icon className="size-4 text-slate-400" />{label}</span>
    <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength}
      disabled={disabled} placeholder={placeholder} className={`${FIELD_CLASS} font-normal`} />
  </label>;
}

function ReadinessItem({ ready, optional = false, title, detail }: { ready: boolean; optional?: boolean; title: string; detail: string }) {
  return <div className="flex items-start gap-3">
    <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${ready ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white text-transparent"}`}><Check className="size-3" /></span>
    <div className="min-w-0"><p className="text-sm font-medium text-slate-800">{title}{optional ? <span className="ml-1.5 text-xs font-normal text-slate-400">选填</span> : null}</p><p className="mt-0.5 text-xs leading-5 text-slate-500">{detail}</p></div>
  </div>;
}
