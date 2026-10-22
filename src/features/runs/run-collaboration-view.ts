import type { RunSummary } from "@/contracts/run";
import { MAX_PAGE_NUMBER } from "@/lib/search-params";
import type { CollaborationListState } from "./run-collaboration-navigation";

export const COLLABORATION_PAGE_SIZE = 10;
const beijingDate = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function collaborationDate(iso: string | null) {
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? beijingDate.format(date) : "时间记录不可读";
}

export function collaborationDuration(run: Pick<RunSummary, "startedAt" | "finishedAt">) {
  if (!run.startedAt || !run.finishedAt) return null;
  const duration = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  if (!Number.isFinite(duration) || duration < 0) return "时间记录待核对";
  const seconds = Math.round(duration / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}

export function collaborationView(runs: RunSummary[], state: CollaborationListState) {
  const query = state.query.toLocaleLowerCase("zh-CN");
  const filtered = runs.filter((run) => (!query || run.agentName.toLocaleLowerCase("zh-CN").includes(query))
    && (!state.sourceType || run.sourceType === state.sourceType) && (!state.status || run.status === state.status));
  const start = (state.page - 1) * COLLABORATION_PAGE_SIZE;
  return {
    rows: filtered.slice(start, start + COLLABORATION_PAGE_SIZE),
    total: filtered.length,
    start,
    hasNext: state.page < MAX_PAGE_NUMBER && start + COLLABORATION_PAGE_SIZE < filtered.length,
    filtered: Boolean(state.query || state.sourceType || state.status),
    summary: {
      total: runs.length,
      active: runs.filter((run) => run.status === "queued" || run.status === "running").length,
      attention: runs.filter((run) => run.status === "waiting_approval" || run.status === "waiting_event" || run.status === "failed").length,
      completed: runs.filter((run) => run.status === "completed").length,
      cancelled: runs.filter((run) => run.status === "cancelled").length,
    },
  };
}
