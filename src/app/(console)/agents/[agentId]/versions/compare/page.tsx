import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentManifest } from "@/contracts/manifest";
import { VersionSummary } from "@/contracts/version";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { compareAgentVersions, type VersionDiff } from "@/server/domain/version-diff";
import { getVersionComparisonSource } from "@/server/queries/versions";
import { SafeQueryError, withSafeQueryError } from "@/server/security/query-error";
import { z } from "zod";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { FrozenResourceComparison } from "@/features/versions/FrozenResourceComparison";
import { frozenResourceBindingsView } from "@/features/versions/frozen-resource-bindings";
import { comparisonResourceView, versionComparisonDiffView, versionComparisonText } from "@/features/versions/version-comparison-presentation";
import { VersionComparisonSelection, versionComparisonDetailsHref } from "@/features/versions/version-comparison-navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, GitCompareArrows, Minus, Plus, RefreshCw, Settings2 } from "lucide-react";

export const dynamic = "force-dynamic";

function ComparisonFeedback({ agentId, message, retry = false }: { agentId: string; message: string; retry?: boolean }) {
  return <main className="page-shell max-w-6xl">
    <Link href={`/agents/${agentId}#versions`} prefetch={false} className="w-fit text-sm font-semibold text-indigo-700">返回版本历史</Link>
    <PageHeader eyebrow="版本对比" title="版本对比暂时无法核对" description="不使用当前草稿或其他版本替代，也不会修改已保存内容。" action={retry ? <PageRefreshButton /> : undefined} />
    <section role="alert" className="content-card text-sm leading-6 text-amber-900">{message}</section>
  </main>;
}

function ChangeGroup({ title, changes }: { title: string; changes: VersionDiff["nodes"] }) {
  const empty = changes.added.length + changes.removed.length + changes.changed.length === 0;
  return <section className="content-card">
    <div className="flex items-center justify-between gap-3"><h2 className="section-title">{title}</h2><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">{empty ? "无变化" : `${changes.added.length + changes.changed.length + changes.removed.length} 项变化`}</span></div>
    {empty ? <p className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500"><CheckCircle2 className="size-4 text-emerald-600" />本项可比字段未发现变化</p> : <div className="mt-4 grid gap-3 md:grid-cols-3">
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
  const uuid = z.string().uuid();
  if (!uuid.safeParse(agentId).success) notFound();
  const selection = VersionComparisonSelection.safeParse(query);
  if (!selection.success) return <ComparisonFeedback agentId={agentId} message="请选择两份不同的已保存版本。对比条件缺失、重复或无效时不会自动选择其他记录。" />;
  let source: Awaited<ReturnType<typeof getVersionComparisonSource>>;
  try {
    source = await withSafeQueryError(() => getVersionComparisonSource(agentId, [selection.data.from, selection.data.to], DEMO_WORKSPACE_ID), "version-compare-page");
  } catch (error) {
    if (!(error instanceof SafeQueryError)) throw error;
    return <ComparisonFeedback agentId={agentId} message="暂时无法读取版本记录，请重新读取。读取失败不表示版本不存在或没有变化。" retry />;
  }
  if (!source) return <ComparisonFeedback agentId={agentId} message="未找到当前助手下可核对的两份版本记录，请返回版本历史重新选择。不能把未取得记录当作空内容。" retry />;
  if (source.before.id !== selection.data.from || source.after.id !== selection.data.to
    || !VersionSummary.shape.version.safeParse(source.before.version).success || !VersionSummary.shape.version.safeParse(source.after.version).success) {
    return <ComparisonFeedback agentId={agentId} message="读取记录与所选对比范围不一致，当前不能核对。请重新读取或返回版本历史。" retry />;
  }
  const beforeResources = comparisonResourceView(frozenResourceBindingsView(source.before.manifest, { originalSnapshotComplete: true }));
  const afterResources = comparisonResourceView(frozenResourceBindingsView(source.after.manifest, { originalSnapshotComplete: true }));
  const before = beforeResources.state === "available" ? AgentManifest.safeParse(source.before.manifest) : null;
  const after = afterResources.state === "available" ? AgentManifest.safeParse(source.after.manifest) : null;
  const identities = [agentId, source.before.id, source.after.id];
  const diff = before?.success && after?.success
    ? versionComparisonDiffView(compareAgentVersions(before.data, after.data), before.data, after.data, identities) : null;
  const changeCount = diff ? [diff.nodes, diff.inputFields, diff.outputFields]
    .reduce((total, group) => total + group.added.length + group.changed.length + group.removed.length, 0)
    + [diff.workflowSettingsChanged, diff.modelChanged, diff.knowledgeChanged].filter(Boolean).length : null;

  return <main className="page-shell max-w-6xl">
    <Link href={`/agents/${agentId}#versions`} prefetch={false} className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-700"><ArrowLeft className="size-4" />返回版本历史</Link>
    <PageHeader eyebrow="版本对比" title="版本变化与资源核对" description={`${before?.success && after?.success ? versionComparisonText(source.agentName, [before.data, after.data], identities) : "当前助手"} · 版本 ${source.before.version} → 版本 ${source.after.version}`} action={<PageRefreshButton />} />
    <section className="content-card flex flex-col gap-4 bg-gradient-to-br from-white to-indigo-50/60 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-indigo-600 text-white"><GitCompareArrows className="size-5" /></span><div><p className="text-xs font-medium text-slate-500">对比范围</p><p className="mt-1 flex items-center gap-2 font-semibold text-slate-900">版本 {source.before.version}<ArrowRight className="size-4 text-indigo-500" />版本 {source.after.version}</p></div></div>
      <div className="sm:text-right"><p className="text-2xl font-bold text-slate-950">{changeCount ?? "待核对"}</p><p className="text-xs text-slate-500">{changeCount === null ? "未计算字段变化" : "项保存字段变化"}</p></div>
    </section>
    <nav aria-label="核对两份冻结版本" className="grid gap-3 lg:grid-cols-2">
      {[{ label: "前一份", record: source.before }, { label: "后一份", record: source.after }].map(({ label, record }) => <Link key={label} href={versionComparisonDetailsHref(agentId, record.id, selection.data)} prefetch={false} className="content-card text-sm font-semibold text-indigo-700">查看{label}冻结流程 · 版本 {record.version}</Link>)}
    </nav>
    {!diff ? <section role="alert" className="content-card text-sm leading-6 text-amber-900">至少一份原记录无法按当前契约完整核对，未计算字段变化。下方仍分别保留两份资源核对范围，未知不能当作空内容或没有变化。</section> : <>
    {!diff.hasChanges ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-700">当前可比字段未发现变化。保存来源、额外字段、权限和执行结果不在这一结论内。</p> : null}
    <ChangeGroup title="流程步骤" changes={diff.nodes} />
    <ChangeGroup title="运行输入" changes={diff.inputFields} />
    <ChangeGroup title="最终交付" changes={diff.outputFields} />
    <section className="content-card">
      <h2 className="section-title flex items-center gap-2"><Settings2 className="size-4 text-indigo-600" />保存字段差异摘要</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {[{ label: "流程运行设置", changed: diff.workflowSettingsChanged }, { label: "运行模型", changed: diff.modelChanged }, { label: "知识资料范围", changed: diff.knowledgeChanged }].map((item) => <li key={item.label} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><p className="text-xs text-slate-500">{item.label}</p><p className={`mt-1 text-sm font-semibold ${item.changed ? "text-amber-700" : "text-emerald-700"}`}>{item.changed ? "有变化" : "没有变化"}</p></li>)}
      </ul>
    </section>
    </>}
    <FrozenResourceComparison beforeView={beforeResources} afterView={afterResources} beforeVersion={source.before.version} afterVersion={source.after.version} />
  </main>;
}
