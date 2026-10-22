"use client";

import { MAX_VISIBLE_TRACE_EVENTS, TraceEventView } from "@/contracts/run";
import { useRunStream } from "@/features/runs/use-run-stream";
const EMPTY_EVENTS: TraceEventView[] = [];

// 轨迹时间线：kind 用图标 + 中文 title（写入侧已产出中文标题），SSE 增量上屏。
// 界面不出现 seq/kind 码值等内部标识。
function KindIcon({ kind, level }: { kind: string; level: TraceEventView["level"] }) {
  const color =
    level === "error"
      ? "text-red-600"
      : level === "warn"
        ? "text-amber-600"
        : "text-gray-500";
  const isFailed = kind.endsWith(".failed");
  const isDone = kind === "run.completed" || kind === "step.succeeded" || kind === "quality.passed";
  const isStart = kind === "run.started" || kind === "step.started";
  let paths: React.ReactNode;
  if (isFailed) {
    paths = <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />;
  } else if (isDone) {
    paths = <path d="M3.5 8.5l3 3L12.5 5" />;
  } else if (kind === "approval.requested") {
    paths = <path d="M5.5 4v8M10.5 4v8" />;
  } else if (kind === "approval.decided") {
    paths = <path d="M3.5 8.5l3 3L12.5 5" />;
  } else if (kind === "condition.decided") {
    paths = <path d="M8 3v4M8 7l-3.5 5M8 7l3.5 5" />;
  } else if (kind === "tool.receipt" || kind === "knowledge.receipt") {
    paths = <path d="M4.5 2.5h5l2.5 2.5v8.5h-7.5zM9.5 2.5V5H12M6 8h4M6 10.5h4" />;
  } else if (isStart) {
    paths = <path d="M5.5 3.5v9L13 8z" />;
  } else {
    paths = <circle cx="8" cy="8" r="2.5" />;
  }
  const filled = isStart;
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      className={`mt-0.5 shrink-0 ${color}`}
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths}
    </svg>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function TraceTimeline({
  runId,
  initialEvents,
  live,
}: {
  runId: string;
  initialEvents: TraceEventView[] | null;
  live: boolean;
}) {
  const events = useRunStream(runId, initialEvents ?? EMPTY_EVENTS, live);
  if (events.length === 0 && initialEvents !== null) {
    return <p className="text-sm text-gray-500">暂无执行轨迹</p>;
  }
  return (
    <>
      {initialEvents === null ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><p className="font-semibold">初始执行轨迹暂时无法读取</p><p className="mt-1">{live ? "实时连接仍会接收事件；下方仅显示本页后续收到的真实记录，不代表已读取完整轨迹。" : "不能将读取失败当作没有轨迹。当前页面未启用实时连接，需重新读取已保存的轨迹。"}可使用页面上方的“重新读取状态”核对。</p></div> : null}
      {events.length >= MAX_VISIBLE_TRACE_EVENTS ? (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-700">
          轨迹较多，页面仅显示最近 {MAX_VISIBLE_TRACE_EVENTS} 条；下载运行报告可查看完整记录。
        </p>
      ) : null}
      <ol className="flex flex-col divide-y divide-gray-100" aria-label="执行轨迹">
        {events.map((event) => (
          <li key={event.seq} className="flex gap-3 py-2" data-testid="trace-row">
            <KindIcon kind={event.kind} level={event.level} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm text-gray-800">{event.title}</p>
              {event.detail ? (
                <p className="whitespace-pre-wrap break-words text-sm text-gray-500">{event.detail}</p>
              ) : null}
              <p className="text-xs text-gray-400">{formatTime(event.at)}</p>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
