import { CreateScheduleForm } from "@/features/schedules/CreateScheduleForm";
import { ScheduleList } from "@/features/schedules/ScheduleList";
import { listScheduleableAgents, listSchedules } from "@/server/queries/schedules";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const [schedules, agents] = await Promise.all([listSchedules(), listScheduleableAgents()]);
  return (
    <main className="mx-auto w-full max-w-3xl px-8 py-8">
      <h1 className="text-xl font-semibold text-gray-900">定时任务</h1>
      <p className="mt-1 text-sm text-gray-600">为已发布的助手设置计划时间，执行结果会进入运行记录。</p>
      <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        系统目前每天自动检查一次到期任务，实际开始时间可能晚于计划时间。固定间隔和一天多个时段需要另接入更频繁的检查，当前不能保证准点执行。
      </p>
      <div className="mt-6"><CreateScheduleForm agents={agents} /></div>
      <div className="mt-6"><ScheduleList initial={schedules} /></div>
    </main>
  );
}
