import { CreateScheduleForm } from "@/features/schedules/CreateScheduleForm";
import { ScheduleList } from "@/features/schedules/ScheduleList";
import { listScheduleableAgents, listSchedules } from "@/server/queries/schedules";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const [schedules, agents] = await Promise.all([listSchedules(), listScheduleableAgents()]);
  return (
    <main className="mx-auto w-full max-w-3xl px-8 py-8">
      <h1 className="text-xl font-semibold text-gray-900">定时任务</h1>
      <p className="mt-1 text-sm text-gray-600">让已发布的助手按设定的时间自动运行，结果进入运行记录。</p>
      <div className="mt-6"><CreateScheduleForm agents={agents} /></div>
      <div className="mt-6"><ScheduleList initial={schedules} /></div>
    </main>
  );
}
