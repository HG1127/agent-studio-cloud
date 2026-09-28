"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, Clock3, FileJson2, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import type { AgentInputField } from "@/contracts/manifest";
import type { ScheduleAgentOption, ScheduleSpec } from "@/contracts/schedule";
import { createScheduleAction } from "@/server/actions/create-schedule";
import { readSessionValue, removeSessionValue, writeSessionValue } from "@/lib/session-storage";
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

export function CreateScheduleForm({ agents }: { agents: ScheduleAgentOption[] }) {
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
  const [pendingRequest, setPendingRequest] = useState<ScheduleCreatePending | null>(null);
  const [confirmNewRequest, setConfirmNewRequest] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? agents[0];
  const inputFields = selectedAgent?.inputContract.fields ?? [];
  const schedulePreview = useMemo(() => {
    if (kind === "once") return at ? `${at.replace("T", " ")}（北京时间）执行一次` : "选择未来的执行时间";
    if (kind === "interval") return `每 ${minutes || "—"} 分钟运行一次`;
    const timeLabel = times.filter(Boolean).join("、") || "待选择时间";
    if (kind === "daily") return `每天 ${timeLabel}`;
    if (kind === "weekly") return `${weekdays.map((day) => WEEKDAY_LABELS[day]).join("、") || "待选择星期"} ${timeLabel}`;
    return `每月 ${days.join("、") || "待选择日期"} 日 ${timeLabel}`;
  }, [at, days, kind, minutes, times, weekdays]);
  const toggleNumber = (list: number[], value: number) => list.includes(value) ? list.filter((item) => item !== value) : [...list, value].sort((a, b) => a - b);

  useEffect(() => {
    const raw = readSessionValue(SCHEDULE_CREATE_PENDING_KEY);
    const recovered = restoreScheduleCreatePending(raw);
    if (!recovered && raw) removeSessionValue(SCHEDULE_CREATE_PENDING_KEY);
    if (!recovered) return;
    let active = true;
    queueMicrotask(() => { if (active) setPendingRequest(recovered); });
    return () => { active = false; };
  }, []);

  async function submit() {
    if (submittingRef.current || pendingRequest) return;
    setError(null); setSuccess(false);
    let spec: ScheduleSpec;
    if (kind === "once") {
      const date = new Date(`${at}:00+08:00`);
      if (!at || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return setError("请选择未来的执行时间");
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
    // 只保存核对线索，不把运行输入和可能的敏感业务数据写进浏览器存储。
    const pendingInfo = { agentName: selectedAgent?.name ?? "所选助手", summary: schedulePreview, submittedAt: new Date().toISOString() };
    setPendingRequest(pendingInfo);
    if (!writeSessionValue(SCHEDULE_CREATE_PENDING_KEY, serializeScheduleCreatePending(pendingInfo))) setStorageUnavailable(true);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await createScheduleAction({ agentId, spec, input });
      if (!result.ok) {
        setError(result.error);
        router.refresh();
        return;
      }
      removeSessionValue(SCHEDULE_CREATE_PENDING_KEY);
      setPendingRequest(null);
      setStorageUnavailable(false);
      setSuccess(true);
      router.refresh();
    } catch {
      setError("暂时无法确认是否创建成功。请先关闭面板核对任务列表，再决定是否重新创建。");
      router.refresh();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
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
          <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex min-h-0 flex-1 flex-col">
            <div className="min-w-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto p-5 sm:p-6">
              {success ? <div role="status" className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 size-5 shrink-0" /><div><p className="font-semibold">定时任务已创建</p><p className="mt-1 leading-6">任务已启用，下次执行时间会显示在任务列表中。</p></div></div> : null}
              {pendingRequest && !success ? <section aria-label="上次创建结果待核对" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                <h2 className="font-semibold">上次创建结果待核对</h2>
                <p className="mt-1">{pendingRequest.agentName} · {pendingRequest.summary}</p>
                <p className="mt-2 text-amber-900">请先关闭面板，在任务总览核对是否已有这条计划。当前服务尚不能按请求精确核对，直接再次创建可能产生重复任务。</p>
                {storageUnavailable ? <p className="mt-1 font-medium">浏览器未能保留这条核对提示；请在离开页面前完成核对。</p> : null}
                {confirmNewRequest ? <div role="group" aria-label="确认重新创建" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-white p-3"><p className="w-full text-xs">确认任务总览后仍要新建？再次提交可能产生另一条相同计划。</p><button type="button" onClick={() => { removeSessionValue(SCHEDULE_CREATE_PENDING_KEY); setPendingRequest(null); setConfirmNewRequest(false); setStorageUnavailable(false); setError(null); }} className="rounded-lg bg-amber-800 px-3 py-2 text-xs font-semibold text-white">确认风险，允许重新创建</button><button type="button" onClick={() => setConfirmNewRequest(false)} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-medium">继续核对</button></div>
                  : <button type="button" onClick={() => setConfirmNewRequest(true)} className="mt-3 text-xs font-semibold text-amber-900 underline underline-offset-2">已核对，准备新建另一条</button>}
              </section> : null}
              <section aria-labelledby="schedule-agent-title" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><StepTitle number="1" id="schedule-agent-title" title="选择要自动运行的助手" hint="这里只显示已有正式版本的助手。" /><div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-slate-700">助手<select value={agentId} onChange={(event) => { setAgentId(event.target.value); setFieldValues({}); setSuccess(false); }} className="h-10 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><span className="inline-flex h-10 w-fit max-w-full items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700"><CheckCircle2 className="size-3.5" />当前显示：正式版本 V{selectedAgent?.version}</span></div></section>
              <section aria-labelledby="schedule-frequency-title" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><StepTitle number="2" id="schedule-frequency-title" title="设置运行频率" hint="系统会按北京时间计算下一次执行。" /><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">{KIND_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={kind === option.value} onClick={() => { setKind(option.value); setSuccess(false); }} className={`rounded-xl border px-3 py-2.5 text-left transition ${kind === option.value ? "border-indigo-600 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-600" : "border-slate-200 text-slate-700 hover:border-indigo-200"}`}><span className="block text-sm font-semibold">{option.label}</span><span className="mt-0.5 block text-[11px] text-slate-500">{option.hint}</span></button>)}</div><TimeSettings kind={kind} at={at} setAt={setAt} minutes={minutes} setMinutes={setMinutes} times={times} setTimes={setTimes} weekdays={weekdays} setWeekdays={setWeekdays} days={days} setDays={setDays} toggleNumber={toggleNumber} /></section>
              <section aria-labelledby="schedule-input-title" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><StepTitle number="3" id="schedule-input-title" title="填写每次运行的输入" hint="这些内容会在每次自动运行时提交给助手。" /><div className="mt-4 space-y-4">{inputFields.length ? inputFields.map((field) => <InputField key={field.name} field={field} value={fieldValues[field.name] ?? ""} onChange={(value) => setFieldValues((current) => ({ ...current, [field.name]: value }))} />) : <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700"><span className="flex items-center gap-2"><FileJson2 className="size-4 text-slate-400" />运行输入（对象格式）</span><textarea value={inputText} onChange={(event) => setInputText(event.target.value)} rows={5} spellCheck={false} className="rounded-xl border border-slate-300 bg-white p-3 font-mono text-sm" /><span className="text-xs font-normal leading-5 text-slate-500">请输入 JSON 对象；密钥和令牌请改用服务端连接配置。</span></label>}</div></section>
              <section aria-labelledby="schedule-preview-title" className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-indigo-700 shadow-sm"><ShieldCheck className="size-4" /></span><div><h2 id="schedule-preview-title" className="text-sm font-semibold text-indigo-950">保存后会这样运行</h2><p className="mt-1 text-sm font-medium text-indigo-900">{selectedAgent?.name} · {schedulePreview}</p><p className="mt-2 text-xs leading-5 text-indigo-800/80">创建后立即启用，每次结果都会进入运行中心。自动运行使用执行时的正式版本；如果之后发布新版本，请核对运行输入是否仍适用。</p></div></div></section>
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
  return <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">{kind === "once" ? <label className="flex max-w-sm flex-col gap-1.5 text-sm font-medium text-slate-700">执行时间<input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-10 rounded-xl border border-slate-300 bg-white px-3 font-normal" /></label> : null}{kind === "interval" ? <label className="flex max-w-xs flex-col gap-1.5 text-sm font-medium text-slate-700">间隔分钟数<span className="relative"><Clock3 className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" /><input type="number" min={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 font-normal" /></span></label> : null}{["daily", "weekly", "monthly"].includes(kind) ? <div><div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-700">运行时间 <span className="font-normal text-slate-400">（最多 5 个）</span></p>{times.length < 5 ? <button type="button" onClick={() => setTimes([...times, "18:00"])} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700"><Plus className="size-3.5" />添加</button> : null}</div><div className="mt-2 flex flex-wrap gap-2">{times.map((time, index) => <div key={index} className="flex items-center rounded-xl border border-slate-200 bg-white p-1"><input aria-label={`运行时间 ${index + 1}`} type="time" value={time} onChange={(e) => setTimes(times.map((item, i) => i === index ? e.target.value : item))} className="h-8 border-0 bg-transparent px-2 text-sm" />{times.length > 1 ? <button type="button" aria-label={`删除运行时间 ${index + 1}`} onClick={() => setTimes(times.filter((_, i) => i !== index))} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-3.5" /></button> : null}</div>)}</div></div> : null}{kind === "weekly" ? <div className="mt-4"><p className="mb-2 text-sm font-medium text-slate-700">运行日</p><div className="flex flex-wrap gap-2">{WEEKDAY_LABELS.map((label, value) => <label key={value} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${weekdays.includes(value) ? "border-indigo-300 bg-indigo-50 font-semibold text-indigo-700" : "border-slate-200 bg-white text-slate-600"}`}><input className="sr-only" type="checkbox" checked={weekdays.includes(value)} onChange={() => setWeekdays(toggleNumber(weekdays, value))} />{label}</label>)}</div></div> : null}{kind === "monthly" ? <div className="mt-4"><p className="mb-2 text-sm font-medium text-slate-700">运行日期</p><div className="grid grid-cols-7 gap-1.5">{Array.from({ length: 28 }, (_, i) => i + 1).map((day) => <button key={day} type="button" aria-pressed={days.includes(day)} onClick={() => setDays(toggleNumber(days, day))} className={`aspect-square rounded-lg border text-xs font-medium ${days.includes(day) ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{day}</button>)}</div></div> : null}</div>;
}
