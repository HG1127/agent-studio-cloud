import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentManifest } from "@/contracts/manifest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { compareAgentVersions, type VersionDiff } from "@/server/domain/version-diff";
import { getVersionComparisonSource } from "@/server/queries/versions";
import { withSafeQueryError } from "@/server/security/query-error";
import { z } from "zod";
import { PageHeader } from "@/components/ui/page-header";
import { ArrowLeft, ArrowRight, CheckCircle2, GitCompareArrows, Minus, Plus, RefreshCw, Settings2 } from "lucide-react";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function ChangeGroup({ title, changes }: { title: string; changes: VersionDiff["nodes"] }) {
  const empty = changes.added.length + changes.removed.length + changes.changed.length === 0;
  return <section className="content-card">
    <div className="flex items-center justify-between gap-3"><h2 className="section-title">{title}</h2><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">{empty ? "无变化" : `${changes.added.length + changes.changed.length + changes.removed.length} 项变化`}</span></div>
    {empty ? <p className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500"><CheckCircle2 className="size-4 text-emerald-600" />两个版本在这里保持一致</p> : <div className="mt-4 grid gap-3 md:grid-cols-3">
      <ChangeList title="新增" values={changes.added} className="border-emerald-100 bg-emerald-50/60 text-emerald-700" icon={<Plus className="size-3.5" />} />
      <ChangeList title="修改" values={changes.changed} className="border-amber-100 bg-amber-50/60 text-amber-700" icon={<RefreshCw className="size-3.5" />} />
      <ChangeList title="移除" values={changes.removed} className="border-red-100 bg-red-50/60 text-red-700" icon={<Minus className="size-3.5" />} />
    </div>}
  </section>;
}

function ChangeList({ title, values, className, icon }: { title: string; values: string[]; className: string; icon: React.ReactNode }) {
  return <div className={`rounded-xl border p-3 ${className}`}>
    <h3 className="flex items-center gap-1.5 text-sm font-semibold">{icon}{title}（{values.length}）</h3>
    {values.length > 0 ? <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
      {values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}
    </ul> : <p className="mt-2 text-sm opacity-60">无</p>}
  </div>;
}

export default async function VersionComparePage({ params, searchParams }: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ agentId }, query] = await Promise.all([params, searchParams]);
  const from = one(query.from);
  const to = one(query.to);
  const uuid = z.string().uuid();
  if (!from || !to || !uuid.safeParse(agentId).success || !uuid.safeParse(from).success || !uuid.safeParse(to).success) notFound();
  const source = await withSafeQueryError(
    () => getVersionComparisonSource(agentId, [from, to], DEMO_WORKSPACE_ID),
    "version-compare-page",
  );
  if (!source) notFound();
  const before = AgentManifest.safeParse(source.before.manifest);
  const after = AgentManifest.safeParse(source.after.manifest);
  if (!before.success || !after.success) notFound();
  const diff = compareAgentVersions(before.data, after.data);
  const changeCount = [diff.nodes, diff.inputFields, diff.outputFields]
    .reduce((total, group) => total + group.added.length + group.changed.length + group.removed.length, 0)
    + [diff.workflowSettingsChanged, diff.modelChanged, diff.knowledgeChanged].filter(Boolean).length;

  return <main className="page-shell max-w-5xl">
    <Link href={`/agents/${agentId}#versions`} className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-700"><ArrowLeft className="size-4" />返回助手详情</Link>
    <PageHeader eyebrow="版本对比" title="版本变化" description={`${source.agentName} · 版本 ${source.before.version} → 版本 ${source.after.version}`} />
    <section className="content-card flex flex-col gap-4 bg-gradient-to-br from-white to-indigo-50/60 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-indigo-600 text-white"><GitCompareArrows className="size-5" /></span><div><p className="text-xs font-medium text-slate-500">对比范围</p><p className="mt-1 flex items-center gap-2 font-semibold text-slate-900">版本 {source.before.version}<ArrowRight className="size-4 text-indigo-500" />版本 {source.after.version}</p></div></div>
      <div className="sm:text-right"><p className="text-2xl font-bold text-slate-950">{changeCount}</p><p className="text-xs text-slate-500">项可执行内容变化</p></div>
    </section>
    {!diff.hasChanges ? <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700"><CheckCircle2 className="size-4" />两个版本的可执行内容一致。</p> : null}
    <ChangeGroup title="流程步骤" changes={diff.nodes} />
    <ChangeGroup title="运行输入" changes={diff.inputFields} />
    <ChangeGroup title="最终交付" changes={diff.outputFields} />
    <section className="content-card">
      <h2 className="section-title flex items-center gap-2"><Settings2 className="size-4 text-indigo-600" />运行资源</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {[{ label: "流程运行设置", changed: diff.workflowSettingsChanged }, { label: "运行模型", changed: diff.modelChanged }, { label: "知识资料范围", changed: diff.knowledgeChanged }].map((item) => <li key={item.label} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><p className="text-xs text-slate-500">{item.label}</p><p className={`mt-1 text-sm font-semibold ${item.changed ? "text-amber-700" : "text-emerald-700"}`}>{item.changed ? "有变化" : "没有变化"}</p></li>)}
      </ul>
    </section>
  </main>;
}
