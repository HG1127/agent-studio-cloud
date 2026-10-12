import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MessageSquareMore,
  type LucideIcon,
} from "lucide-react";
import type { RunListFilters, RunStatus } from "@/contracts/run";
import { cn } from "@/lib/utils";
import { runsHref } from "./run-filter-url";

const FOCUS_ITEMS: Array<{
  status: RunStatus;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  activeTone: string;
}> = [
  {
    status: "waiting_approval",
    label: "等你处理",
    description: "先决定是否继续",
    icon: Clock3,
    tone: "bg-amber-50 text-amber-700",
    activeTone: "border-amber-300 bg-amber-50/80 ring-2 ring-amber-100",
  },
  {
    status: "running",
    label: "正在执行",
    description: "查看当前进度",
    icon: Activity,
    tone: "bg-indigo-50 text-indigo-700",
    activeTone: "border-indigo-300 bg-indigo-50/80 ring-2 ring-indigo-100",
  },
  {
    status: "waiting_event",
    label: "等待继续",
    description: "等待消息或补充",
    icon: MessageSquareMore,
    tone: "bg-cyan-50 text-cyan-700",
    activeTone: "border-cyan-300 bg-cyan-50/80 ring-2 ring-cyan-100",
  },
  {
    status: "failed",
    label: "需要处理",
    description: "先查看失败原因",
    icon: AlertTriangle,
    tone: "bg-red-50 text-red-700",
    activeTone: "border-red-300 bg-red-50/80 ring-2 ring-red-100",
  },
  {
    status: "completed",
    label: "已有结果",
    description: "优先查看最终交付",
    icon: CheckCircle2,
    tone: "bg-emerald-50 text-emerald-700",
    activeTone: "border-emerald-300 bg-emerald-50/80 ring-2 ring-emerald-100",
  },
];

export function RunFocusNav({ filters }: { filters: RunListFilters }) {
  return (
    <nav aria-label="按任务优先级查看" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
      {FOCUS_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = filters.status === item.status;
        return (
          <Link
            key={item.status}
            href={runsHref({ ...filters, status: item.status })}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
              item.status === "completed" && "col-span-2 xl:col-span-1",
              active && item.activeTone,
            )}
          >
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", item.tone)}>
              <Icon aria-hidden="true" className="size-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-950">{item.label}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">{item.description}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
