import Link from "next/link";
import { RunStatus, type RunSummary } from "@/contracts/run";

// 状态徽标唯一文案源：列表页与详情页共用
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "排队中",
  running: "运行中",
  waiting_approval: "等待确认",
  waiting_event: "等待继续",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const RUN_STATUS_STYLES: Record<RunStatus, string> = {
  queued: "bg-gray-100 text-gray-600",
  running: "bg-blue-50 text-blue-700",
  waiting_approval: "bg-amber-50 text-amber-700",
  waiting_event: "bg-cyan-50 text-cyan-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${RUN_STATUS_STYLES[status]}`}>
      {RUN_STATUS_LABEL[status]}
    </span>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function RunList({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
        还没有运行记录，到助手详情页运行一个试试
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {runs.map((run) => (
        <li key={run.id}>
          <Link
            href={`/runs/${run.id}`}
            className="block rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-400"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-medium">{run.agentName}</span>
              <span className="flex items-center gap-2">
                {run.sourceType === "schedule" && (
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">定时</span>
                )}
                <RunStatusBadge status={run.status} />
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-400">
              {run.startedAt ? `开始于 ${formatTime(run.startedAt)}` : "尚未开始"}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
