import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentManifest } from "@/contracts/manifest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { compareAgentVersions, type VersionDiff } from "@/server/domain/version-diff";
import { getVersionComparisonSource } from "@/server/queries/versions";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function ChangeGroup({ title, changes }: { title: string; changes: VersionDiff["nodes"] }) {
  const empty = changes.added.length + changes.removed.length + changes.changed.length === 0;
  return <section className="rounded-lg border border-gray-200 bg-white p-4">
    <h2 className="font-semibold">{title}</h2>
    {empty ? <p className="mt-2 text-sm text-gray-500">没有变化</p> : <div className="mt-3 grid gap-4 md:grid-cols-3">
      <ChangeList title="新增" values={changes.added} className="text-emerald-700" />
      <ChangeList title="修改" values={changes.changed} className="text-amber-700" />
      <ChangeList title="移除" values={changes.removed} className="text-red-700" />
    </div>}
  </section>;
}

function ChangeList({ title, values, className }: { title: string; values: string[]; className: string }) {
  return <div>
    <h3 className={`text-sm font-medium ${className}`}>{title}（{values.length}）</h3>
    {values.length > 0 ? <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
      {values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}
    </ul> : <p className="mt-1 text-sm text-gray-400">无</p>}
  </div>;
}

export default async function VersionComparePage({ params, searchParams }: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ agentId }, query] = await Promise.all([params, searchParams]);
  const from = one(query.from);
  const to = one(query.to);
  if (!from || !to) notFound();
  const source = await getVersionComparisonSource(agentId, [from, to], DEMO_WORKSPACE_ID);
  if (!source) notFound();
  const before = AgentManifest.safeParse(source.before.manifest);
  const after = AgentManifest.safeParse(source.after.manifest);
  if (!before.success || !after.success) notFound();
  const diff = compareAgentVersions(before.data, after.data);

  return <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-8">
    <Link href={`/agents/${agentId}`} className="w-fit text-sm text-gray-500 hover:text-gray-700">← 返回助手详情</Link>
    <header>
      <h1 className="text-2xl font-bold">版本变化</h1>
      <p className="mt-1 text-sm text-gray-500">{source.agentName} · 版本 {source.before.version} → 版本 {source.after.version}</p>
    </header>
    {!diff.hasChanges ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">两个版本的可执行内容一致。</p> : null}
    <ChangeGroup title="流程步骤" changes={diff.nodes} />
    <ChangeGroup title="运行输入" changes={diff.inputFields} />
    <ChangeGroup title="最终交付" changes={diff.outputFields} />
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="font-semibold">运行资源</h2>
      <ul className="mt-2 space-y-1 text-sm text-gray-700">
        <li>流程运行设置：{diff.workflowSettingsChanged ? "有变化" : "没有变化"}</li>
        <li>运行模型：{diff.modelChanged ? "有变化" : "没有变化"}</li>
        <li>知识资料范围：{diff.knowledgeChanged ? "有变化" : "没有变化"}</li>
      </ul>
    </section>
  </main>;
}
