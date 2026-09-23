"use client";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import type { ScheduleView } from "@/contracts/schedule";
import { updateScheduleStatusAction } from "@/server/actions/update-schedule-status";

const STATUS_LABELS: Record<ScheduleView["status"], string> = {
  active: "运行中",
  paused: "已暂停",
  error: "出错",
  archived: "已归档",
};
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function specSummary(spec: ScheduleView["spec"]): string {
  if (spec.kind === "once") {
    return `${new Date(spec.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} 执行一次`;
  }
  if (spec.kind === "interval") {
    return `每 ${spec.minutes} 分钟`;
  }
  const times = spec.times.join("、");
  if (spec.kind === "daily") return `每天 ${times}`;
  if (spec.kind === "weekly") return `每周${spec.weekdays.map((day) => WEEKDAY_LABELS[day]).join("、")} ${times}`;
  return `每月 ${spec.days.join("、")} 日 ${times}`;
}

export function ScheduleList({ initial }: { initial: ScheduleView[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  useEffect(() => {
    const timer = setInterval(() => startTransition(() => router.refresh()), 5000);
    return () => clearInterval(timer);
  }, [router]);

  const update = async (id: string, next: "paused" | "active" | "archived") => {
    const result = await updateScheduleStatusAction(id, next);
    if (!result.ok) window.alert(result.error);
    startTransition(() => router.refresh());
  };

  if (initial.length === 0) {
    return <p className="text-sm text-gray-600">还没有定时任务，用上方表单给已发布的助手设置自动运行。</p>;
  }
  return (
    <ul className="space-y-2">
      {initial.map((schedule) => (
        <li key={schedule.id} className="flex items-center justify-between rounded-lg border bg-white p-3">
          <div>
            <p className="text-sm font-medium text-gray-900">{schedule.agentName}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {specSummary(schedule.spec)}
              {schedule.nextRunAt ? ` · 下次运行 ${new Date(schedule.nextRunAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : ""}
            </p>
            {schedule.lastError && <p className="mt-0.5 text-xs text-red-600">最近一次失败：{schedule.lastError}</p>}
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-xs ${schedule.status === "error" ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-700"}`}>
              {STATUS_LABELS[schedule.status]}
            </span>
            {schedule.status !== "archived" && (
              <button
                type="button"
                className="text-xs text-gray-500 hover:text-gray-900"
                onClick={() => update(schedule.id, schedule.status === "active" ? "paused" : "active")}
              >
                {schedule.status === "active" ? "暂停" : "恢复"}
              </button>
            )}
            {schedule.status !== "archived" && (
              <button type="button" className="text-xs text-gray-500 hover:text-gray-900" onClick={() => update(schedule.id, "archived")}>
                删除
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
