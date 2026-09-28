import Link from "next/link";
import { CircleAlert, Settings2, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { HarnessRunPicker } from "@/features/harness/HarnessRunPicker";
import { RunDiagnostics } from "@/features/harness/RunDiagnostics";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { firstSearchParam } from "@/lib/search-params";
import { getRunView, listRuns, listRunSteps } from "@/server/queries/runs";
import { listRecentTrace } from "@/server/queries/trace";
import { withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

export default async function HarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requested = firstSearchParam((await searchParams).run);
  const recentRuns = await withSafeQueryError(() => listRuns(DEMO_WORKSPACE_ID, {}, { limit: 30 }), "harness-runs");
  const selectedId = requested ?? recentRuns.find((run) => ["failed", "waiting_approval", "waiting_event"].includes(run.status))?.id ?? recentRuns[0]?.id ?? null;
  const validId = selectedId && z.string().uuid().safeParse(selectedId).success ? selectedId : null;
  const run = validId ? await withSafeQueryError(() => getRunView(validId, DEMO_WORKSPACE_ID), "harness-run") : null;
  const [steps, trace] = run ? await withSafeQueryError(() => Promise.all([
    listRunSteps(run.id, DEMO_WORKSPACE_ID), listRecentTrace(run.id, DEMO_WORKSPACE_ID),
  ]), "harness-evidence") : [[], []];

  return <main className="page-shell">
    <PageHeader eyebrow="专业运行管理" title="运行控制台" description="从已保存的任务、步骤和轨迹排查问题；人工确认、补充资料与重试仍在任务详情处理。" action={<PageRefreshButton />} />
    <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-950">这里展示真实运行证据，但尚不包含旧版的默认运行策略、安全规则命中、上下文预算或策略模拟。轨迹事件不能代替完整的规则判决。</div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.7fr)]">
      <HarnessRunPicker runs={recentRuns} selectedId={run?.id ?? null} />
      {run ? <RunDiagnostics run={run} steps={steps} trace={trace} /> : <section className="content-card flex min-h-72 flex-col items-center justify-center text-center"><CircleAlert className="size-7 text-slate-400" /><h2 className="mt-3 text-base font-semibold text-slate-900">{requested ? "找不到这次运行" : "选择一次运行查看诊断"}</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{requested ? "这条链接可能已失效，或当前工作区无权查看。请从左侧选择可见任务。" : "有运行记录后，可核对真实执行步骤和需关注的轨迹。"}</p><Link href="/runs" className="mt-4 text-sm font-semibold text-indigo-700">前往运行记录</Link></section>}
    </div>
    <section aria-labelledby="harness-gaps-title" className="content-card"><h2 id="harness-gaps-title" className="section-title">尚未接入的运行控制</h2><p className="mt-1 text-sm leading-6 text-slate-500">旧版控制台还有以下管理能力。当前服务端没有可读取的生效状态或对应动作，因此这里不提供不能真正生效的开关。</p><div className="mt-4 grid gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><Settings2 className="size-5 text-indigo-600" /><h3 className="mt-3 text-sm font-semibold text-slate-900">默认运行规则</h3><p className="mt-1 text-xs leading-5 text-slate-600">失败恢复、结果复核、记忆与上下文容量需要服务端返回已生效的配置。</p></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><ShieldCheck className="size-5 text-indigo-600" /><h3 className="mt-3 text-sm font-semibold text-slate-900">安全规则</h3><p className="mt-1 text-xs leading-5 text-slate-600">规则列表、优先级、启停和命中记录尚不能从云端核对。</p></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><CircleAlert className="size-5 text-indigo-600" /><h3 className="mt-3 text-sm font-semibold text-slate-900">策略模拟</h3><p className="mt-1 text-xs leading-5 text-slate-600">身份或环境变化后的判断必须由服务端只读计算，不能在浏览器中猜测。</p></div>
    </div></section>
  </main>;
}
