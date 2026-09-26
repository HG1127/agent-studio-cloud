"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ScheduleAgentOption } from "@/contracts/schedule";
import { createScheduleAction } from "@/server/actions/create-schedule";

type Kind = "once" | "interval" | "daily" | "weekly" | "monthly";
type SpecDraft =
  | { kind: "once"; at: string }
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; times: string[] }
  | { kind: "weekly"; weekdays: number[]; times: string[] }
  | { kind: "monthly"; days: number[]; times: string[] };

const KIND_OPTIONS: Array<{ value: Kind; label: string }> = [
  { value: "once", label: "执行一次" },
  { value: "interval", label: "固定间隔" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
];
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function CreateScheduleForm({ agents }: { agents: ScheduleAgentOption[] }) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>("daily");
  const [times, setTimes] = useState<string[]>(["09:00"]);
  const [minutes, setMinutes] = useState("5");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [days, setDays] = useState<number[]>([1]);
  const [at, setAt] = useState("");
  const [inputText, setInputText] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleNumber = (list: number[], value: number): number[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value].sort((a, b) => a - b);

  if (agents.length === 0) {
    return <p className="rounded-lg border bg-white p-4 text-sm text-gray-600">还没有可定时的助手：先创建助手并发布版本，再回到这里设置自动运行。</p>;
  }
  return (
    <section className="rounded-lg border bg-white p-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          let spec: SpecDraft;
          if (kind === "once") {
            if (!at) {
              setError("请选择一次性任务的执行时间");
              return;
            }
            spec = { kind, at: new Date(at).toISOString() };
          } else if (kind === "interval") {
            spec = { kind, minutes: Number(minutes) };
          } else if (kind === "daily") {
            spec = { kind, times };
          } else if (kind === "weekly") {
            spec = { kind, weekdays, times };
          } else {
            spec = { kind, days, times };
          }
          let input: Record<string, unknown>;
          try {
            input = JSON.parse(inputText) as Record<string, unknown>;
          } catch {
            setError("运行输入不是有效的 JSON，请检查后重试");
            return;
          }
          setSubmitting(true);
          const result = await createScheduleAction({ agentId, spec, input });
          setSubmitting(false);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.refresh();
        }}
      >
        <div className="flex flex-wrap gap-3">
          <label className="text-sm text-gray-700">
            助手
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)} className="ml-2 rounded border px-2 py-1 text-sm">
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            频率类型
            <select value={kind} onChange={(event) => setKind(event.target.value as Kind)} className="ml-2 rounded border px-2 py-1 text-sm">
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {kind === "interval" && (
            <label className="text-sm text-gray-700">
              间隔分钟
              <input type="number" min={5} value={minutes} onChange={(event) => setMinutes(event.target.value)} className="ml-2 w-20 rounded border px-2 py-1 text-sm" />
            </label>
          )}
          {kind === "once" && (
            <label className="text-sm text-gray-700">
              计划时间
              <input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} className="ml-2 rounded border px-2 py-1 text-sm" />
            </label>
          )}
        </div>
        {(kind === "daily" || kind === "weekly" || kind === "monthly") && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
            <span>计划时间（最多 5 个）</span>
            {times.map((time, index) => (
              <input
                key={index}
                type="time"
                value={time}
                onChange={(event) => setTimes(times.map((item, i) => (i === index ? event.target.value : item)))}
                className="rounded border px-2 py-1 text-sm"
              />
            ))}
            {times.length < 5 && (
              <button type="button" onClick={() => setTimes([...times, "18:00"])} className="rounded border px-2 py-1 text-xs">
                添加时间
              </button>
            )}
          </div>
        )}
        {kind === "weekly" && (
          <div className="flex flex-wrap gap-2 text-sm text-gray-700">
            {WEEKDAY_LABELS.map((label, value) => (
              <label key={value} className="flex items-center gap-1">
                <input type="checkbox" checked={weekdays.includes(value)} onChange={() => setWeekdays(toggleNumber(weekdays, value))} />
                {label}
              </label>
            ))}
          </div>
        )}
        {kind === "monthly" && (
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => setDays(toggleNumber(days, day))}
                className={`h-7 w-7 rounded border text-xs ${days.includes(day) ? "bg-gray-900 text-white" : "bg-white text-gray-700"}`}
              >
                {day}
              </button>
            ))}
          </div>
        )}
        <label className="text-sm text-gray-700">
          运行输入（JSON）
          <textarea value={inputText} onChange={(event) => setInputText(event.target.value)} rows={2} className="mt-1 w-full rounded border px-2 py-1 font-mono text-xs" />
        </label>
        <div>
          <button type="submit" disabled={submitting} className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {submitting ? "创建中…" : "创建定时任务"}
          </button>
        </div>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
