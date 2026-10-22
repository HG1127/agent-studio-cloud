import Link from "next/link";
import { AlertCircle, ArrowLeft, History } from "lucide-react";
import { CreateScheduleForm } from "@/features/schedules/CreateScheduleForm";
import { ScheduleList } from "@/features/schedules/ScheduleList";
import { listScheduleableAgents, listSchedules } from "@/server/queries/schedules";
import { getAgentDetail, listAgentTargets } from "@/server/queries/agents";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { PageHeader } from "@/components/ui/page-header";
import { SectionReadState } from "@/components/ui/SectionReadState";
import { withSafeQueryError } from "@/server/security/query-error";
import { agentScheduleReturnHref, matchesAgentScheduleScope, parseAgentScheduleScope } from "@/features/schedules/agent-schedule-scope";

export const dynamic = "force-dynamic";

async function read<T>(operation: () => Promise<T>, label: string) {
  return withSafeQueryError(operation, label).then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const }),
  );
}

const linkClass = "inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50";

function ScopeUnavailable({ title, description, retry = false, agentId }: { title: string; description: string; retry?: boolean; agentId?: string }) {
  const returnHref = agentId ? agentScheduleReturnHref(agentId) : null;
  return <main className="page-shell"><PageHeader eyebrow="自动运行" title="定时任务" description="尚未确认当前助手范围，没有显示其他助手的计划。" action={<Link href="/schedules" className={linkClass}>查看全部计划</Link>} />
    {retry ? <SectionReadState id="schedule-scope" title={title} description={description} /> : <section className="content-card"><h2 className="section-title">{title}</h2><p role="alert" className="mt-3 text-sm leading-6 text-amber-950">{description}</p></section>}
    {returnHref ? <Link href={returnHref} className={linkClass}><ArrowLeft className="size-4" />返回助手工作台</Link> : <Link href="/agents" className={linkClass}>返回助手列表</Link>}</main>;
}

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = parseAgentScheduleScope((await searchParams).agent);
  if (scope.kind === "invalid") return <ScopeUnavailable title="助手范围无效" description="请从助手工作台重新打开计划。重复或无效的助手条件不会扩大为全部计划。" />;
  const agentId = scope.kind === "agent" ? scope.agentId : undefined;
  let agentName: string | undefined;
  if (agentId) {
    const detail = await read(() => getAgentDetail(agentId, DEMO_WORKSPACE_ID), "schedule-agent-scope");
    if (!detail.ok) return <ScopeUnavailable agentId={agentId} retry title="助手范围暂时无法核对" description="暂时无法确认这个助手是否可用，不是没有计划。可以返回原助手；重新读取只核对范围，不创建或修改任务。" />;
    if (!detail.value || detail.value.agent.id.toLowerCase() !== agentId) return <ScopeUnavailable agentId={agentId} title="这个助手当前不可用" description="未找到当前可用的助手，可能已停用或不属于当前空间。返回原助手后也可能暂不可读；没有改用其他助手，已有任务可到全部计划核对。" />;
    agentName = detail.value.agent.name;
  }
  const [scheduleRead, agentRead, versionRead] = await Promise.all([
    read(listSchedules, "schedule-list"), read(listScheduleableAgents, "schedule-create-agents"),
    read(() => listAgentTargets(DEMO_WORKSPACE_ID, ""), "schedule-create-versions"),
  ]);
  const schedules = scheduleRead.ok ? scheduleRead.value.filter((item) => matchesAgentScheduleScope(scope, item.agentId)) : null;
  const agents = agentRead.ok ? agentRead.value.filter((item) => matchesAgentScheduleScope(scope, item.id)) : null;
  const productionVersions = versionRead.ok ? versionRead.value.filter((item) => matchesAgentScheduleScope(scope, item.agentId)) : null;
  const sessionKey = agentId ? `agent:${agentId}` : "all";
  const runsHref = agentId ? `/runs?source=schedule&agent=${encodeURIComponent(agentId)}` : "/runs?source=schedule";
  return (
    <main className="page-shell">
      {agentId ? <nav aria-label="定时任务范围" className="flex flex-wrap gap-3"><Link href={agentScheduleReturnHref(agentId)!} className={linkClass}><ArrowLeft className="size-4" />返回助手工作台</Link><Link href="/schedules" className={linkClass}>查看全部计划</Link></nav> : null}
      <PageHeader
        eyebrow="自动运行"
        title={agentName ? `${agentName}的定时任务` : "定时任务"}
        description={agentId ? "这里只管理这个助手的计划时间和运行输入，不会修改其他助手的任务。" : "为已发布的助手设置计划时间，实际执行结果进入运行记录。"}
        action={<><Link href={runsHref} className={linkClass}><History className="size-4" />{agentId ? "此助手的自动运行记录" : "自动运行记录"}</Link>{agents && productionVersions ? <CreateScheduleForm key={sessionKey} agentScope={agentId} agents={agents} productionVersions={productionVersions} /> : null}</>}
      />
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">系统目前每天自动检查一次到期任务，实际开始时间可能晚于计划时间。固定间隔和一天多个时段需要另接入更频繁的检查，当前不能保证准点执行。</p>
      {!agents || !productionVersions ? <SectionReadState id="schedule-create-read" title="创建条件暂时无法读取" description="暂时无法核对可创建助手或正式版本输入，不表示没有正式版本。这里只暂停新建；已读取的计划仍可查看。" /> : agents.length === 0 ? <section className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-700" /><div><h2 className="text-sm font-semibold text-amber-950">{agentId ? "这个助手尚无可用正式版本" : "先发布一个正式版本"}</h2><p className="mt-1 text-sm leading-6 text-amber-800">只有已有正式版本的助手才能创建定时任务；没有切换到其他助手。</p></div></div><Link href={agentId ? agentScheduleReturnHref(agentId)! + "#versions" : "/agents"} className={linkClass}>{agentId ? "返回助手发布版本" : "查看助手"}</Link></section> : null}
      {schedules ? <section aria-label={agentId ? "此助手的计划" : "全部计划"} className="content-card">
        <div className="mb-5 flex flex-col gap-2 border-b border-slate-100 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="section-title">{agentId ? "此助手的计划" : "任务总览"}</h2><p className="mt-1 text-sm leading-6 text-slate-500">优先处理失败任务；暂停和归档不会删除已经生成的运行记录。</p></div><p className="text-xs text-slate-400">时间口径：北京时间（UTC+8）</p></div>
        {agentId && schedules.length === 0 ? <p className="mb-4 text-sm text-slate-600">这个助手当前没有可读取的未归档计划，不代表其他助手没有计划。</p> : null}
        <ScheduleList key={sessionKey} initial={schedules} />
      </section> : <SectionReadState id="schedule-list-read" title="计划列表暂时无法读取" description="当前不能确认计划数量或状态，不是没有计划。重新读取不会创建、启停或归档任务。" />}
    </main>
  );
}
