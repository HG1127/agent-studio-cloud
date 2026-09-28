import Link from "next/link";
import { ArrowRight, BadgeCheck, CheckCircle2, CircleAlert, FlaskConical, Rocket, Search, TestTube2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { QualityJourney } from "@/features/quality/QualityJourney";
import { AcceptanceRunButton } from "@/features/quality/AcceptanceRunButton";
import { acceptanceStatus } from "@/features/quality/acceptance-status";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { firstSearchParam, pageFromSearchParam } from "@/lib/search-params";
import { listAgents } from "@/server/queries/agents";
import { listEvaluationCases, listEvaluationRuns } from "@/server/queries/evaluations";
import { listVersions } from "@/server/queries/versions";
import { withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

function pageHref(page: number, query: string) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/acceptance?${suffix}` : "/acceptance";
}

export default async function AcceptancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const page = pageFromSearchParam(params.page);
  const query = firstSearchParam(params.q)?.trim().slice(0, 200) ?? "";
  const agentRows = await withSafeQueryError(
    () => listAgents(DEMO_WORKSPACE_ID, { query: query || undefined, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    "acceptance-agents",
  );
  const agents = agentRows.slice(0, PAGE_SIZE);
  const hasNext = agentRows.length > PAGE_SIZE;
  const rows = await withSafeQueryError(() => Promise.all(agents.map(async (agent) => {
    const [cases, runs, versions] = await Promise.all([
      listEvaluationCases(agent.id, DEMO_WORKSPACE_ID, { limit: 101 }),
      listEvaluationRuns(agent.id, DEMO_WORKSPACE_ID, { limit: 1 }),
      listVersions(agent.id, DEMO_WORKSPACE_ID, { limit: 101 }),
    ]);
    return { agent, cases, latest: runs[0] ?? null, versions };
  })), "acceptance-overview");

  const prioritizedRows = rows.map((row) => {
    const status = acceptanceStatus({ casesCount: row.cases.length, latest: row.latest, versions: row.versions });
    const candidate = row.versions.find((version) => version.status === "candidate");
    const activeVersion = candidate ?? row.versions.find((version) => version.status === "production");
    return { ...row, ...status, candidate, activeVersion, href: `/agents/${row.agent.id}#${status.anchor}` };
  }).sort((left, right) => left.priority - right.priority);
  const passed = prioritizedRows.filter((row) => row.summary === "passed").length;
  const issues = prioritizedRows.filter((row) => row.summary === "issues").length;
  const waiting = prioritizedRows.filter((row) => row.summary === "waiting").length;

  const toneClasses = {
    blue: "bg-blue-50 text-blue-700 ring-blue-600/10",
    red: "bg-red-50 text-red-700 ring-red-600/10",
    amber: "bg-amber-50 text-amber-700 ring-amber-600/10",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/10",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
    slate: "bg-slate-100 text-slate-600 ring-slate-500/10",
  } as const;

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="质量与证据"
        title="验收中心"
        description="先准备固定样例，再运行自动验收；每次结果都会保留逐项证据。"
        action={<><PageRefreshButton /><Link href="/releases" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50"><Rocket className="size-4" />查看发布状态</Link></>}
      />
      <QualityJourney active="acceptance" />
      <section className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-sm leading-6 text-blue-950">
        <b>验收原则：</b> 固定样例用于发现回归问题；候选版本全部通过后会自动上线。自动结果是发布证据，仍需结合真实业务结果判断。
      </section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["本页已有测试样例", rows.filter((row) => row.cases.length > 0).length, TestTube2, "bg-indigo-50 text-indigo-600"],
          ["本页当前版本最近通过", passed, CheckCircle2, "bg-emerald-50 text-emerald-600"],
          ["本页需要修复", issues, CircleAlert, "bg-red-50 text-red-600"],
          ["本页待准备或待验收", waiting, FlaskConical, "bg-amber-50 text-amber-600"],
        ].map(([label, value, Icon, tone]) => {
          const ItemIcon = Icon as typeof BadgeCheck;
          return <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4"><span className={`grid size-9 place-items-center rounded-xl ${tone}`}><ItemIcon className="size-[18px]" /></span><p className="mt-4 text-xs font-medium text-slate-500">{label as string}</p><p className="mt-1 text-2xl font-bold text-slate-950">{value as number}</p></article>;
        })}
      </section>
      <section className="content-card">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><h2 className="section-title">待办与验收证据</h2><p className="mt-1 text-sm text-slate-500">优先显示运行中、未通过和需要准备的助手。</p></div>
          <form action="/acceptance" method="get" role="search" className="flex w-full max-w-md gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">搜索助手</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input type="search" name="q" defaultValue={query} placeholder="搜索助手名称或说明" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
            </label>
            <button type="submit" className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700">搜索</button>
          </form>
        </div>
        {prioritizedRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            {page > 1
              ? <>当前页没有验收记录，列表可能已经变化。<Link href={pageHref(page - 1, query)} className="ml-2 font-semibold text-indigo-600 hover:text-indigo-700">返回上一页</Link></>
              : query
              ? <>没有找到与“{query}”相关的助手。<Link href="/acceptance" className="ml-2 font-semibold text-indigo-600 hover:text-indigo-700">清除搜索</Link></>
              : <>还没有助手。<Link href="/agents/new" className="ml-2 font-semibold text-indigo-600 hover:text-indigo-700">创建助手</Link>后即可准备验收。</>}
          </div>
        ) : (
          <ul className="grid min-w-0 gap-3 lg:grid-cols-2">
            {prioritizedRows.map(({ agent, cases, latest, candidate, activeVersion, label, tone, detail, action, href }) => <li key={agent.id} className="group min-w-0 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200 hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h3 className="truncate font-semibold text-slate-950">{agent.name}</h3><p className="mt-1.5 text-xs leading-5 text-slate-500">{detail}</p></div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${toneClasses[tone as keyof typeof toneClasses]}`}>{label}</span>
              </div>
              {latest && activeVersion?.version === latest.version && latest.totalCount > 0 ? <div className="mt-3" aria-label="上次验收进度">
                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-slate-500"><span>上次验收已通过</span><span>{latest.passedCount}/{latest.totalCount} 项</span></div>
                <div role="progressbar" aria-label={`${agent.name}上次验收通过比例`} aria-valuemin={0} aria-valuemax={latest.totalCount} aria-valuenow={latest.passedCount} className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${latest.failedCount > 0 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.round(latest.passedCount / latest.totalCount * 100)}%` }} /></div>
              </div> : null}
              <div className="mt-4 flex flex-wrap items-start gap-3">
                <Link href={href} className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-800">{candidate && cases.length > 0 && action === "验收当前版本" ? "检查样例与验收记录" : action}<ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden="true" /></Link>
                <AcceptanceRunButton agentId={agent.id} agentName={agent.name} versionId={activeVersion?.id ?? null} caseCount={cases.length} candidate={Boolean(candidate)} running={latest?.status === "running"} previouslyEvaluated={Boolean(candidate && latest?.version === candidate.version)} />
              </div>
            </li>)}
          </ul>
        )}
        {(page > 1 || hasNext) ? <nav aria-label="验收中心翻页" className="mt-5 flex items-center justify-end gap-3 text-sm"><span className="text-slate-500">第 {page} 页</span>{page > 1 ? <Link href={pageHref(page - 1, query)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 hover:bg-slate-50">上一页</Link> : null}{hasNext ? <Link href={pageHref(page + 1, query)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 hover:bg-slate-50">下一页</Link> : null}</nav> : null}
      </section>
    </main>
  );
}
