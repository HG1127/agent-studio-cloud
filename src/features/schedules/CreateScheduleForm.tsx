"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, Clock3, FileJson2, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import type { AgentInputField } from "@/contracts/manifest";
import type { AgentTargetOption } from "@/contracts/agent";
import type { ScheduleAgentOption, ScheduleCreateInput, ScheduleSpec } from "@/contracts/schedule";
import { ScheduleActionResult } from "@/contracts/schedule";
import { createScheduleAction } from "@/server/actions/create-schedule";
import { readSessionValue, removeSessionValue, writeSessionValue } from "@/lib/session-storage";
import { matchesAgentScheduleScope, parseAgentScheduleScope } from "./agent-schedule-scope";
import {
  SCHEDULE_CREATE_PENDING_KEY,
  restoreScheduleCreatePending,
  serializeScheduleCreatePending,
  type ScheduleCreatePending,
} from "./schedule-create-pending";

type Kind = ScheduleSpec["kind"];
const KIND_OPTIONS: Array<{ value: Kind; label: string; hint: string }> = [
  { value: "once", label: "执行一次", hint: "临时任务" },
  { value: "interval", label: "固定间隔", hint: "最短 5 分钟" },
  { value: "daily", label: "每天", hint: "固定时间" },
  { value: "weekly", label: "每周", hint: "选择星期" },
  { value: "monthly", label: "每月", hint: "选择日期" },
];
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function captureSubmissionTime() {
  return Date.now();
}

function parseFields(fields: AgentInputField[], values: Record<string, string>): { input?: Record<string, unknown>; error?: string } {
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    const label = field.label ?? field.name;
    const raw = values[field.name] ?? "";
    if (!raw.trim()) {
      if (field.required) return { error: `请填写${label}` };
      continue;
    }
    if (field.type === "number") {
      const value = Number(raw);
      if (!Number.isFinite(value)) return { error: `${label}必须是数字` };
      input[field.name] = value;
    } else if (field.type === "boolean") input[field.name] = raw === "true";
    else if (field.type === "object" || field.type === "array") {
      try {
        const value = JSON.parse(raw) as unknown;
        const invalid = field.type === "array" ? !Array.isArray(value) : !value || typeof value !== "object" || Array.isArray(value);
        if (invalid) return { error: `${label}的格式不正确` };
        input[field.name] = value;
      } catch { return { error: `${label}的格式不正确` }; }
    } else input[field.name] = raw;
  }
  return { input };
}

function InputField({ field, value, onChange }: { field: AgentInputField; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
      <span>{field.label ?? field.name}<span className="ml-1 text-xs font-normal text-slate-400">（{field.required ? "必填" : "选填"}）</span></span>
      {field.type === "boolean" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>
      ) : field.type === "object" || field.type === "array" ? (
        <textarea value={value} rows={4} placeholder={field.type === "array" ? "[]" : "{}"} onChange={(event) => onChange(event.target.value)} className="rounded-xl border border-slate-300 bg-white p-3 font-mono text-sm" />
      ) : <input type={field.type === "number" ? "number" : "text"} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm" />}
    </label>
  );
}

type CreateScheduleFormProps = { agents: ScheduleAgentOption[]; productionVersions?: AgentTargetOption[]; agentScope?: string };

export function CreateScheduleForm({ agents, productionVersions = [], agentScope }: CreateScheduleFormProps) {
  const scope = parseAgentScheduleScope(agentScope);
  if (scope.kind === "invalid") return <p role="alert" className="text-sm text-amber-900">助手范围无效，不能创建计划。</p>;
  const scopedId = scope.kind === "agent" ? scope.agentId : undefined;
  return <ScheduleFormSession key={scopedId ? `agent:${scopedId}` : "all"} scopeAgentId={scopedId}
    agents={agents.filter((agent) => matchesAgentScheduleScope(scope, agent.id))}
    productionVersions={productionVersions.filter((version) => matchesAgentScheduleScope(scope, version.agentId))} />;
}

function ScheduleFormSession({ agents, productionVersions, scopeAgentId }: { agents: ScheduleAgentOption[]; productionVersions: AgentTargetOption[]; scopeAgentId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>("daily");
  const [times, setTimes] = useState(["09:00"]);
  const [minutes, setMinutes] = useState("30");
  const [weekdays, setWeekdays] = useState([1]);
  const [days, setDays] = useState([1]);
  const [at, setAt] = useState("");
  const [inputText, setInputText] = useState("{}");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const requestRef = useRef<{ fingerprint: string; input: ScheduleCreateInput } | null>(null);
  const [canRetryOriginal, setCanRetryOriginal] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<ScheduleCreatePending | null>(null);
  const [confirmNewRequest, setConfirmNewRequest] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const ownerRef = useRef<object | null>(null);
  useLayoutEffect(() => {
    const owner = {};
    ownerRef.current = owner;
    return () => { if (ownerRef.current === owner) ownerRef.current = null; };
  }, []);
  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const selectedVersion = productionVersions.filter((version) => version.agentId === agentId).sort((left, right) => right.version - left.version)[0];
  const inputFields = selectedVersion?.inputContract.fields ?? [];
  const schedulePreview = useMemo(() => {
    if (kind === "once") return at ? `${at.replace("T", " ")}（北京时间）执行一次` : "选择未来的计划时间";
    if (kind === "interval") return `每 ${minutes || "—"} 分钟运行一次`;
    const timeLabel = times.filter(Boolean).join("、") || "待选择时间";
    if (kind === "daily") return `每天 ${timeLabel}`;
    if (kind === "weekly") return `${weekdays.map((day) => WEEKDAY_LABELS[day]).join("、") || "待选择星期"} ${timeLabel}`;
    return `每月 ${days.join("、") || "待选择日期"} 日 ${timeLabel}`;
  }, [at, days, kind, minutes, times, weekdays]);
  const toggleNumber = (list: number[], value: number) => list.includes(value) ? list.filter((item) => item !== value) : [...list, value].sort((a, b) => a - b);

  useEffect(() => {
    const owner = ownerRef.current;
    const raw = readSessionValue(SCHEDULE_CREATE_PENDING_KEY);
    const recovered = restoreScheduleCreatePending(raw);
    if (!recovered && raw) removeSessionValue(SCHEDULE_CREATE_PENDING_KEY);
    if (!recovered) return;
    let active = true;
    queueMicrotask(() => {
      if (active && owner && ownerRef.current === owner) {
        setPendingRequest(recovered);
      }
    });
    return () => { active = false; };
  }, []);

  async function submit(submittedAtMs: number) {
    if (submittingRef.current || pendingRequest || !ownerRef.current) return;
    const stored = restoreScheduleCreatePending(readSessionValue(SCHEDULE_CREATE_PENDING_KEY));
    if (stored) {
      setPendingRequest(stored);
      setCanRetryOriginal(false);
      requestRef.current = null;
      return;
    }
    setError(null); setSuccess(false);
    if (!selectedAgent || (scopeAgentId && selectedAgent.id.toLowerCase() !== scopeAgentId)) return setError("请重新选择当前可用的助手");
    let spec: ScheduleSpec;
    if (kind === "once") {
      const date = new Date(`${at}:00+08:00`);
      if (!at || Number.isNaN(date.getTime()) || date.getTime() <= submittedAtMs) return setError("请选择未来的计划时间");
      spec = { kind, at: date.toISOString() };
    } else if (kind === "interval") {
      const value = Number(minutes);
      if (!Number.isInteger(value) || value < 5) return setError("固定间隔不能少于 5 分钟");
      spec = { kind, minutes: value };
    } else if (kind === "daily") spec = { kind, times };
    else if (kind === "weekly") {
      if (!weekdays.length) return setError("请至少选择一个运行日");
      spec = { kind, weekdays, times };
    } else {
      if (!days.length) return setError("请至少选择一个运行日期");
      spec = { kind, days, times };
    }
    let input: Record<string, unknown>;
    if (inputFields.length) {
      const parsed = parseFields(inputFields, fieldValues);
      if (!parsed.input) return setError(parsed.error ?? "请检查运行输入");
      input = parsed.input;
    } else {
      try {
        const parsed = JSON.parse(inputText) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return setError("运行输入必须是 JSON 对象");
        input = parsed as Record<string, unknown>;
      } catch { return setError("运行输入不是有效的 JSON，请检查后重试"); }
    }
    const pendingInfo = { agentName: selectedAgent?.name ?? "所选助手", summary: schedulePreview, submittedAt: new Date(submittedAtMs).toISOString() };
    const fingerprint = JSON.stringify({ agentId, spec, input });
    const request = requestRef.current?.fingerprint === fingerprint
      ? requestRef.current
      : { fingerprint, input: { agentId, spec, input, requestId: crypto.randomUUID() } };
    requestRef.current = request;
    setCanRetryOriginal(true);
    await sendRequest(request.input, pendingInfo);
  }

  function clearStoredPending(pendingInfo: ScheduleCreatePending) {
    if (readSessionValue(SCHEDULE_CREATE_PENDING_KEY) === serializeScheduleCreatePending(pendingInfo)) removeSessionValue(SCHEDULE_CREATE_PENDING_KEY);
  }

  async function sendRequest(input: ScheduleCreateInput, pendingInfo: ScheduleCreatePending, rechecking = false) {
    const owner = ownerRef.current;
    if (!owner || submittingRef.current || (scopeAgentId && input.agentId.toLowerCase() !== scopeAgentId)) return;
    setError(null);
    // 浏览器存储只保存核对线索；原输入和请求仅保留在当前页面内存。
    setPendingRequest(pendingInfo);
    if (!writeSessionValue(SCHEDULE_CREATE_PENDING_KEY, serializeScheduleCreatePending(pendingInfo))) setStorageUnavailable(true);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await createScheduleAction(input);
      if (ownerRef.current !== owner) return;
      const parsed = ScheduleActionResult.safeParse(response);
      if (!parsed.success) throw new Error("invalid schedule response");
      const result = parsed.data;
      if (!result.ok) {
        if (!rechecking && !result.retryable) {
          requestRef.current = null;
          setCanRetryOriginal(false);
          clearStoredPending(pendingInfo);
          setPendingRequest(null);
          setStorageUnavailable(false);
        }
        setError(rechecking ? `本次核对未获准，上次创建结果仍待确认。${result.error}` : result.error);
        router.refresh();
        return;
      }
      clearStoredPending(pendingInfo);
      setPendingRequest(null);
      setStorageUnavailable(false);
      setSuccess(true);
      router.refresh();
    } catch {
      if (ownerRef.current !== owner) return;
      setError("暂时无法确认是否创建成功。请先关闭面板核对任务列表，再决定是否重新创建。");
      router.refresh();
    } finally {
      if (ownerRef.current === owner) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  if (!agents.length) return <button type="button" disabled title="请先发布助手正式版本" className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-200 px-4 text-sm font-semibold text-slate-500"><Plus className="size-4" />新建定时任务</button>;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!submitting) { setOpen(next); setError(null); if (!next) setSuccess(false); } }}>
      <Dialog.Trigger asChild><button type="button" className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"><Plus className="size-4" />新建定时任务</button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-x-hidden bg-slate-50 shadow-2xl outline-none">
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6"><div><p className="text-xs font-bold tracking-[0.16em] text-indigo-600">自动运行</p><Dialog.Title className="mt-1 text-xl font-bold text-slate-950">新建定时任务</Dialog.Title><Dialog.Description className="mt-1 text-sm leading-6 text-slate-500">选择已发布的助手；所有时间按北京时间计算。</Dialog.Description></div><Dialog.Close aria-label="关闭创建面板" className="grid size-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-5" /></Dialog.Close></header>
          <form onSubmit={(event) => { event.preventDefault(); void submit(captureSubmissionTime()); }} className="flex min-h-0 flex-1 flex-col">
            <div className="min-w-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto p-5 sm:p-6">
              {success ? <div role="status" className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 size-5 shrink-0" /><div><p className="font-semibold">定时任务已创建</p><p className="mt-1 leading-6">这里确认创建请求已保存；当前状态请核对计划列表，实际开始可能更晚。</p></div></div> : null}
              {pendingRequest && !success ? <section aria-label="上次创建结果待核对" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                <h2 className="font-semibold">上次创建结果待核对</h2>
                <p className="mt-1">{pendingRequest.agentName} · {pendingRequest.summary}</p>
                <p className="mt-2">这条提示来自本浏览器的全部计划，未确认属于当前助手，也不表示已创建成功。</p>
                <Link href="/schedules" className="mt-2 inline-block font-semibold underline underline-offset-2">到全部计划核对</Link>
                <p className="mt-2 text-amber-900">可先关闭面板，在任务总览核对是否已有这条计划。本页仍保留原请求时，可以按原设置核对；刷新后只保留提示，不恢复业务输入。新建另一条可能产生重复任务。</p>
                {canRetryOriginal ? <button type="button" disabled={submitting} onClick={() => { const request = requestRef.current; if (request) void sendRequest(request.input, pendingRequest, true); }} className="mt-3 rounded-lg bg-amber-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{submitting ? "正在核对…" : "核对上次创建请求"}</button> : null}
                {storageUnavailable ? <p className="mt-1 font-medium">浏览器未能保留这条核对提示；请在离开页面前完成核对。</p> : null}
                {confirmNewRequest ? <div role="group" aria-label="确认重新创建" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-white p-3"><p className="w-full text-xs">确认任务总览后仍要新建？再次提交可能产生另一条相同计划。</p><button type="button" disabled={submitting} onClick={() => { if (submittingRef.current || !ownerRef.current) return; requestRef.current = null; setCanRetryOriginal(false); clearStoredPending(pendingRequest); setPendingRequest(null); setConfirmNewRequest(false); setStorageUnavailable(false); setError(null); }} className="rounded-lg bg-amber-800 px-3 py-2 text-xs font-semibold text-white">确认风险，允许重新创建</button><button type="button" disabled={submitting} onClick={() => setConfirmNewRequest(false)} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-medium">继续核对</button></div>
                  : <button type="button" disabled={submitting} onClick={() => { if (!submittingRef.current) setConfirmNewRequest(true); }} className="mt-3 text-xs font-semibold text-amber-900 underline underline-offset-2">已核对，准备新建另一条</button>}
              </section> : null}
              <section aria-labelledby="schedule-agent-title" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><StepTitle number="1" id="schedule-agent-title" title="选择要自动运行的助手" hint="这里只显示已有正式版本的助手。" /><div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-slate-700">助手<select value={agentId} disabled={Boolean(scopeAgentId) || submitting || Boolean(pendingRequest)} onChange={(event) => { setAgentId(event.target.value); setFieldValues({}); setInputText("{}"); setSuccess(false); setError(null); }} className="h-10 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><span className="inline-flex h-10 w-fit max-w-full items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700"><CheckCircle2 className="size-3.5" />{selectedVersion ? `当前显示：正式版本 V${selectedVersion.version}` : "正式版本输入信息暂不可读"}</span></div></section>
              <section aria-labelledby="schedule-frequency-title" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><StepTitle number="2" id="schedule-frequency-title" title="设置运行频率" hint="系统会按北京时间计算下一次执行。" /><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">{KIND_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={kind === option.value} onClick={() => { setKind(option.value); setSuccess(false); }} className={`rounded-xl border px-3 py-2.5 text-left transition ${kind === option.value ? "border-indigo-600 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-600" : "border-slate-200 text-slate-700 hover:border-indigo-200"}`}><span className="block text-sm font-semibold">{option.label}</span><span className="mt-0.5 block text-[11px] text-slate-500">{option.hint}</span></button>)}</div><TimeSettings kind={kind} at={at} setAt={setAt} minutes={minutes} setMinutes={setMinutes} times={times} setTimes={setTimes} weekdays={weekdays} setWeekdays={setWeekdays} days={days} setDays={setDays} toggleNumber={toggleNumber} /></section>
              <section aria-labelledby="schedule-input-title" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><StepTitle number="3" id="schedule-input-title" title="填写每次运行的输入" hint="这些内容会在每次自动运行时提交给助手。" /><div className="mt-4 space-y-4">{inputFields.length ? inputFields.map((field) => <InputField key={field.name} field={field} value={fieldValues[field.name] ?? ""} onChange={(value) => setFieldValues((current) => ({ ...current, [field.name]: value }))} />) : <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700"><span className="flex items-center gap-2"><FileJson2 className="size-4 text-slate-400" />运行输入（对象格式）</span><textarea value={inputText} onChange={(event) => setInputText(event.target.value)} rows={5} spellCheck={false} className="rounded-xl border border-slate-300 bg-white p-3 font-mono text-sm" /><span className="text-xs font-normal leading-5 text-slate-500">请输入 JSON 对象；密钥和令牌请改用服务端连接配置。</span></label>}</div></section>
              <section aria-labelledby="schedule-preview-title" className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-indigo-700 shadow-sm"><ShieldCheck className="size-4" /></span><div><h2 id="schedule-preview-title" className="text-sm font-semibold text-indigo-950">保存后会这样运行</h2><p className="mt-1 text-sm font-medium text-indigo-900">{selectedAgent?.name} · {schedulePreview}</p><p className="mt-2 text-xs leading-5 text-indigo-800/80">创建后启用，实际执行结果会进入运行中心。系统目前每天检查一次到期任务，不保证准点开始。自动运行使用执行时的正式版本；如果之后发布新版本，请核对运行输入是否仍适用。</p></div></div></section>
              {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
            </div>
            <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="text-xs leading-5 text-slate-500">创建后可随时暂停或归档，不影响已有运行记录。</p><div className="flex gap-2"><Dialog.Close className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">{success ? "关闭" : pendingRequest ? "关闭并核对列表" : "取消"}</Dialog.Close>{success ? <Dialog.Close className="inline-flex h-10 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">完成</Dialog.Close> : <button type="submit" disabled={submitting || Boolean(pendingRequest)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"><CalendarClock className="size-4" />{submitting ? "正在创建…" : "创建并启用"}</button>}</div></footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function StepTitle({ number, id, title, hint }: { number: string; id: string; title: string; hint: string }) {
  return <div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">{number}</span><div><h2 id={id} className="text-sm font-semibold text-slate-950">{title}</h2><p className="mt-0.5 text-xs text-slate-500">{hint}</p></div></div>;
}

function TimeSettings({ kind, at, setAt, minutes, setMinutes, times, setTimes, weekdays, setWeekdays, days, setDays, toggleNumber }: { kind: Kind; at: string; setAt: (v: string) => void; minutes: string; setMinutes: (v: string) => void; times: string[]; setTimes: (v: string[]) => void; weekdays: number[]; setWeekdays: (v: number[]) => void; days: number[]; setDays: (v: number[]) => void; toggleNumber: (list: number[], value: number) => number[] }) {
  return <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">{kind === "once" ? <label className="flex max-w-sm flex-col gap-1.5 text-sm font-medium text-slate-700">计划时间<input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-10 rounded-xl border border-slate-300 bg-white px-3 font-normal" /></label> : null}{kind === "interval" ? <label className="flex max-w-xs flex-col gap-1.5 text-sm font-medium text-slate-700">间隔分钟数<span className="relative"><Clock3 className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" /><input type="number" min={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 font-normal" /></span></label> : null}{["daily", "weekly", "monthly"].includes(kind) ? <div><div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-700">计划时间 <span className="font-normal text-slate-400">（最多 5 个）</span></p>{times.length < 5 ? <button type="button" onClick={() => setTimes([...times, "18:00"])} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700"><Plus className="size-3.5" />添加</button> : null}</div><div className="mt-2 flex flex-wrap gap-2">{times.map((time, index) => <div key={index} className="flex items-center rounded-xl border border-slate-200 bg-white p-1"><input aria-label={`计划时间 ${index + 1}`} type="time" value={time} onChange={(e) => setTimes(times.map((item, i) => i === index ? e.target.value : item))} className="h-8 border-0 bg-transparent px-2 text-sm" />{times.length > 1 ? <button type="button" aria-label={`删除计划时间 ${index + 1}`} onClick={() => setTimes(times.filter((_, i) => i !== index))} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-3.5" /></button> : null}</div>)}</div></div> : null}{kind === "weekly" ? <div className="mt-4"><p className="mb-2 text-sm font-medium text-slate-700">运行日</p><div className="flex flex-wrap gap-2">{WEEKDAY_LABELS.map((label, value) => <label key={value} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${weekdays.includes(value) ? "border-indigo-300 bg-indigo-50 font-semibold text-indigo-700" : "border-slate-200 bg-white text-slate-600"}`}><input className="sr-only" type="checkbox" checked={weekdays.includes(value)} onChange={() => setWeekdays(toggleNumber(weekdays, value))} />{label}</label>)}</div></div> : null}{kind === "monthly" ? <div className="mt-4"><p className="mb-2 text-sm font-medium text-slate-700">运行日期</p><div className="grid grid-cols-7 gap-1.5">{Array.from({ length: 28 }, (_, i) => i + 1).map((day) => <button key={day} type="button" aria-pressed={days.includes(day)} onClick={() => setDays(toggleNumber(days, day))} className={`aspect-square rounded-lg border text-xs font-medium ${days.includes(day) ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{day}</button>)}</div></div> : null}</div>;
}
