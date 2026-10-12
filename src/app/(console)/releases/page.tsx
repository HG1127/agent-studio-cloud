import Link from "next/link";
import { ArchiveRestore, ArrowRight, FlaskConical, Globe2, History, Rocket, Search, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { QualityJourney } from "@/features/quality/QualityJourney";
import { releaseStatus } from "@/features/quality/release-status";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { firstSearchParam, pageFromSearchParam } from "@/lib/search-params";
import { listAgents } from "@/server/queries/agents";
import { listEvaluationRuns } from "@/server/queries/evaluations";
import { listVersions } from "@/server/queries/versions";
import { withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

function pageHref(page: number, query: string) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/releases?${suffix}` : "/releases";
}

export default async function ReleasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const page = pageFromSearchParam(params.page);
  const query = firstSearchParam(params.q)?.trim().slice(0, 200) ?? "";
  const header = <PageHeader
    eyebrow="版本安全"
    title="发布中心"
    description="统一查看候选、正式和历史版本；发布与恢复操作在对应助手工作台完成。"
    action={<><PageRefreshButton /><Link href="/acceptance" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50"><FlaskConical className="size-4" />进入验收中心</Link><Link href="/web-tools" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50"><Globe2 className="size-4" />网页工具</Link></>}
  />;
  const agentRows = await withSafeQueryError(
    () => listAgents(DEMO_WORKSPACE_ID, { query: query || undefined, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    "release-agents",
  ).catch(() => null);
  if (!agentRows) return <main className="page-shell">{header}<QualityJourney active="release" /><section role="alert" className="content-card border-amber-200 bg-amber-50/50"><h2 className="section-title">版本列表暂时无法读取</h2><p className="mt-2 text-sm leading-6 text-amber-950">当前无法核对助手的候选、正式和历史版本。已发布状态不会因此改变；请使用页头重新读取，或直接进入对应助手查看。</p><Link href="/agents" className="mt-4 inline-flex h-9 items-center rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-900">查看助手</Link></section></main>;
  const agents = agentRows.slice(0, PAGE_SIZE);
  const hasNext = agentRows.length > PAGE_SIZE;
  const settledRows = await Promise.allSettled(agents.map(async (agent) => {
    const versions = await listVersions(agent.id, DEMO_WORKSPACE_ID);
    const evaluationRuns = versions.some((version) => version.status === "candidate")
      ? await listEvaluationRuns(agent.id, DEMO_WORKSPACE_ID, { limit: 1 })
      : [];
    return { agent, versions, latestEvaluation: evaluationRuns[0] ?? null };
  }));
  const rows = settledRows.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const unavailableAgents = agents.filter((_, index) => settledRows[index]?.status === "rejected");
  if (unavailableAgents.length) console.error(`[release-overview] ${unavailableAgents.length} 位助手的版本状态暂时无法读取`);
  const production = rows.filter((row) => row.versions.some((version) => version.status === "production")).length;
  const candidates = rows.filter((row) => row.versions.some((version) => version.status === "candidate")).length;
  const history = rows.reduce((count, row) => count + row.versions.filter((version) => ["retired", "superseded"].includes(version.status)).length, 0);
  const prioritizedRows = rows.map((row) => {
    const live = row.versions.find((version) => version.status === "production");
    const candidate = row.versions.find((version) => version.status === "candidate");
    const retired = row.versions.filter((version) => ["retired", "superseded"].includes(version.status));
    const status = releaseStatus({ versions: row.versions, latest: row.latestEvaluation });
    return { ...row, live, candidate, retired, ...status, href: `/agents/${row.agent.id}#${status.anchor}` };
  }).sort((left, right) => left.priority - right.priority);

  return (
    <main className="page-shell">
      {header}
      <QualityJourney active="release" />
      {unavailableAgents.length ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">本页有 {unavailableAgents.length} 位助手的版本状态暂时无法读取。下方统计只包含已读取的 {rows.length} 位；可重新读取状态，或逐一打开助手核对。</div> : null}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          [unavailableAgents.length ? "已读取正式版本" : "本页正式运行", production, Rocket, "bg-emerald-50 text-emerald-600", "已有生产版本"],
          [unavailableAgents.length ? "已读取候选版本" : "本页等待发布", candidates, ShieldCheck, "bg-indigo-50 text-indigo-600", "候选版本需完成门槛"],
          [unavailableAgents.length ? "已读取历史版本" : "本页历史版本", history, History, "bg-slate-100 text-slate-600", "可对比；曾上线版本可恢复"],
        ].map(([label, value, Icon, tone, detail]) => {
          const ItemIcon = Icon as typeof Rocket;
          return <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4"><span className={`grid size-9 place-items-center rounded-xl ${tone}`}><ItemIcon className="size-[18px]" /></span><p className="mt-4 text-xs font-medium text-slate-500">{label as string}</p><p className="mt-1 text-2xl font-bold text-slate-950">{value as number}</p><p className="mt-1 text-xs text-slate-400">{detail as string}</p></article>;
        })}
      </section>
      <section className="content-card">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><h2 className="section-title">发布状态与下一步</h2><p className="mt-1 text-sm text-slate-500">候选版本和异常状态优先显示，便于集中处理。</p></div>
          <form action="/releases" method="get" role="search" className="flex w-full max-w-md gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">搜索助手</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input type="search" name="q" defaultValue={query} placeholder="搜索助手名称或说明" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
            </label>
            <button type="submit" className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700">搜索</button>
          </form>
        </div>
        {agents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            {page > 1
              ? <>当前页没有发布记录，列表可能已经变化。<Link href={pageHref(page - 1, query)} className="ml-2 font-semibold text-indigo-600 hover:text-indigo-700">返回上一页</Link></>
              : query
              ? <>没有找到与“{query}”相关的助手。<Link href="/releases" className="ml-2 font-semibold text-indigo-600 hover:text-indigo-700">清除搜索</Link></>
              : <>还没有可发布的助手。<Link href="/agents/new" className="ml-2 font-semibold text-indigo-600 hover:text-indigo-700">创建助手</Link>后开始设计流程。</>}
          </div>
        ) : (
          <ul className="space-y-3">
            {unavailableAgents.map((agent) => <li key={agent.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h3 className="break-words font-semibold text-slate-900">{agent.name}</h3><p className="mt-1 text-sm leading-6 text-amber-900">版本状态暂时无法读取，不能判断是否已有正式或候选版本。</p></div><Link href={`/agents/${agent.id}#versions`} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-indigo-700">打开助手核对<ArrowRight className="size-4" /></Link></div></li>)}
            {prioritizedRows.map(({ agent, live, candidate, retired, status, statusTone, summary, action, href }) => (
              <li key={agent.id} className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200 hover:shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2"><h3 className="min-w-0 break-words font-semibold text-slate-950">{agent.name}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusTone}`}>{status}</span></div>
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">{summary}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs md:min-w-[360px]">
                    <span className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5"><small className="block text-slate-400">正式版本</small><b className="mt-1 block text-slate-800">{live ? `版本 ${live.version}` : "无"}</b></span>
                    <span className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5"><small className="block text-slate-400">候选版本</small><b className="mt-1 block text-slate-800">{candidate ? `版本 ${candidate.version}` : "无"}</b></span>
                    <span className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5"><small className="block text-slate-400">历史版本</small><b className="mt-1 flex items-center gap-1 text-slate-800"><ArchiveRestore className="size-3" />{retired.length}</b></span>
                  </div>
                  <Link href={href} className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-800">{action}<ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden="true" /></Link>
                  {retired.length > 0 && !href.endsWith("#versions") ? <Link href={`/agents/${agent.id}#versions`} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-600 hover:text-indigo-700"><ArchiveRestore className="size-3.5" />查看历史稳定版本</Link> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {(page > 1 || hasNext) ? <nav aria-label="发布中心翻页" className="mt-5 flex items-center justify-end gap-3 text-sm"><span className="text-slate-500">第 {page} 页</span>{page > 1 ? <Link href={pageHref(page - 1, query)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 hover:bg-slate-50">上一页</Link> : null}{hasNext ? <Link href={pageHref(page + 1, query)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 hover:bg-slate-50">下一页</Link> : null}</nav> : null}
      </section>
    </main>
  );
}
