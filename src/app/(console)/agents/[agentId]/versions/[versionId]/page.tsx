import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AgentManifest } from "@/contracts/manifest";
import { VersionExportFile, VersionSummary } from "@/contracts/version";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { FrozenWorkflowViewer } from "@/features/versions/FrozenWorkflowViewer";
import { frozenInputView, frozenOutputView, frozenWorkflowView } from "@/features/versions/frozen-workflow-view";
import { frozenResourceBindingsView } from "@/features/versions/frozen-resource-bindings";
import { FrozenVersionNavigation, frozenVersionReturnHref } from "@/features/versions/version-view-navigation";
import { frozenVersionComparisonReturnHref } from "@/features/versions/version-comparison-navigation";
import { getVersionExportSource } from "@/server/queries/versions";
import { withSafeQueryError } from "@/server/security/query-error";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";

export const dynamic = "force-dynamic";
const STATUS_LABELS: Record<string, string> = { production: "当前正式版本", candidate: "待验收版本", retired: "历史正式版本", superseded: "未上线版本" };

export default async function FrozenVersionPage({ params, searchParams }: {
  params: Promise<{ agentId: string; versionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ agentId, versionId }, query] = await Promise.all([params, searchParams]);
  const uuid = z.string().uuid();
  if (!uuid.safeParse(agentId).success || !uuid.safeParse(versionId).success) notFound();
  const navigation = FrozenVersionNavigation.safeParse(query);
  const comparisonReturn = frozenVersionComparisonReturnHref(agentId, versionId, query);
  const returnHref = comparisonReturn ?? (navigation.success ? frozenVersionReturnHref(agentId, versionId, navigation.data) : `/agents/${agentId}#versions`);
  const returnLabel = comparisonReturn ? "返回版本对比" : !navigation.success ? "返回版本第一页" : navigation.data.source === "web-tools" ? "返回网页工具核对" : "返回版本历史";
  const source = await withSafeQueryError(() => getVersionExportSource(agentId, versionId, DEMO_WORKSPACE_ID), "frozen-version-page");
  if (!source) notFound();
  const manifest = AgentManifest.safeParse(source.manifest);
  const metadata = VersionExportFile.shape.version.safeParse({
    number: source.version, status: source.status,
    createdAt: source.createdAt instanceof Date && !Number.isNaN(source.createdAt.getTime()) ? source.createdAt.toISOString() : null,
  });
  if (!manifest.success || !metadata.success) return <main className="page-shell">
    <PageHeader eyebrow="冻结版本读取" title="已保存版本暂时无法核对" description="读取到版本记录，但冻结内容或日期不符合当前契约；不能当作版本已删除，也不从当前草稿替代。" action={<PageRefreshButton />} />
    <section role="alert" className="content-card"><p className="text-sm leading-6 text-amber-900">请重新读取，或返回版本历史核对其他记录。此页面不会修改冻结版本、恢复版本或启动任务。</p><Link href={returnHref} prefetch={false} className="mt-3 inline-flex text-sm font-semibold text-indigo-700">{returnLabel}</Link></section>
  </main>;
  let view: ReturnType<typeof frozenWorkflowView>;
  let input: AgentManifest["inputContract"];
  let output: AgentManifest["outputContract"];
  try {
    view = frozenWorkflowView(manifest.data.workflowSnapshot, source.manifest.workflowSnapshot);
    input = frozenInputView(manifest.data.inputContract);
    output = frozenOutputView(manifest.data.outputContract);
  } catch {
    return <main className="page-shell"><PageHeader eyebrow="冻结版本读取" title="冻结内容预览暂时不可用" description="版本记录仍存在，但当前不能安全生成只读预览；不使用当前草稿补造。" action={<PageRefreshButton />} /><section role="alert" className="content-card"><p className="text-sm leading-6 text-amber-900">可以重新读取，或返回版本历史核对已保存定义。</p><Link href={returnHref} prefetch={false} className="mt-3 inline-flex text-sm font-semibold text-indigo-700">{returnLabel}</Link></section></main>;
  }
  const version = VersionSummary.parse({ id: versionId, version: metadata.data.number, status: metadata.data.status, createdAt: metadata.data.createdAt });
  const created = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(version.createdAt));
  const resources = frozenResourceBindingsView(source.manifest, { originalSnapshotComplete: true });
  return <main className="page-shell">
    <Link href={returnHref} prefetch={false} className="w-fit text-sm font-semibold text-indigo-700">{returnLabel}</Link>
    <PageHeader eyebrow="冻结版本核对" title={redactSensitiveText(source.agentName) + " · 版本 " + version.version} description="直接核对这个已保存版本的流程与约定，不展示当前可编辑草稿。" action={<PageRefreshButton />} />
    <section aria-label="冻结版本范围" className="content-card flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{Object.hasOwn(STATUS_LABELS, version.status) ? STATUS_LABELS[version.status] : "版本状态待核对"} · 只读</p><p className="mt-1 text-xs leading-5 text-slate-500">版本创建于 {created}（北京时间），不是正式发布时间。状态来自本次读取，不保证此后仍是当前版本。</p><p className="mt-1 text-xs leading-5 text-slate-500">展示已脱敏，深层内容可能省略；不证明连接、权限、资料或模型目前可用，也不是运行经过与发布门槛结论。</p></div><a href={`/api/agents/${agentId}/versions/${versionId}/export`} download className="text-sm font-semibold text-indigo-700">下载原版本定义</a><p className="basis-full text-xs leading-5 text-slate-500">下载包含这个版本的原始冻结设置，请按内部资料保管；不会恢复或重新发布版本。</p></section>
    {!navigation.success && !comparisonReturn ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">返回范围无效，未跳转到外部地址或另一助手。当前仍核对指定版本，可显式返回版本第一页。</p> : null}
    <FrozenWorkflowViewer key={versionId} workflow={view} input={input} output={output} resources={resources} />
  </main>;
}
