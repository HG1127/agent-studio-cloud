import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { SectionLoadingState } from "@/components/ui/SectionLoadingState";
import { WebToolSources } from "@/features/web-tools/WebToolSources";
import { WebToolTrialResult } from "@/features/web-tools/WebToolTrialResult";
import { webToolNavigation } from "@/features/web-tools/web-tool-navigation";
import { WebToolsWorkspace } from "@/features/web-tools/WebToolsWorkspace";
import { AgentTargetOption } from "@/contracts/agent";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";

export const dynamic = "force-dynamic";

async function PublishedTools() {
  let targets: AgentTargetOption[] | null = null;
  try {
    const { listAgentTargets } = await import("@/server/queries/agents");
    const parsed = AgentTargetOption.array().parse(await listAgentTargets(DEMO_WORKSPACE_ID, ""));
    if (new Set(parsed.map((target) => target.versionId.toLowerCase())).size !== parsed.length) throw new Error("版本来源无法核对");
    targets = parsed;
  } catch { targets = null; }
  return <WebToolsWorkspace targets={targets} />;
}

export default async function WebToolsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const navigation = webToolNavigation(await searchParams);

  return <main className="page-shell">
    <PageHeader eyebrow="网页交付" title="网页工具" description="设计清晰的填写页面、结果呈现与访问方式；已有工具可继续发布、调用和管理凭据。"
      action={<><PageRefreshButton /><Link href="/releases" className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">返回发布中心</Link></>} />
    <Suspense fallback={<SectionLoadingState id="published-tool-management" title="正在读取可发布的正式版本" description="不自动选择版本，不读取或生成凭据，不发布或调用工具。" />}><PublishedTools /></Suspense>
    <section aria-labelledby="web-tool-version-reference-title" className="min-w-0 space-y-4 border-t border-slate-200 pt-6">
      <div><p className="eyebrow">版本与成果参考</p><h2 id="web-tool-version-reference-title" className="section-title mt-1">正式版本与内部试填</h2><p className="mt-2 text-sm leading-6 text-slate-500">查看真实版本的业务字段和已保存成果；内部试填不等于公开网页发布。</p></div>
    {navigation.invalid ? <section role="alert" className="content-card border-amber-200 bg-amber-50"><p className="text-sm leading-6 text-amber-950">网址中的版本或运行选择无法核对，未使用该选择，也没有自动打开其他任务。重复选择或仅提供任务而没有版本都会被拦截。</p><Link href="/web-tools" prefetch={false} className="mt-2 inline-block text-sm font-semibold text-indigo-700">清除网址选择，重新核对</Link></section> : <Suspense key={`result:${navigation.state.versionId ?? "none"}:${navigation.state.runId ?? "none"}`} fallback={<SectionLoadingState id="web-tool-run-result" title="正在读取内部运行结果" description="正在核对本次任务及其版本归属，尚未展示交付结果。" />}><WebToolTrialResult navigation={navigation.state} /></Suspense>}
    <Suspense key={`sources:${navigation.invalid ? "invalid" : navigation.state.versionId ?? "current"}`} fallback={<SectionLoadingState id="web-tool-sources" title="正在读取正式版本清单" description="读取真实的正式版本及业务字段，不会自动创建任务或发布网页。" />}><WebToolSources navigation={navigation.state} invalid={navigation.invalid} /></Suspense>
    </section>
  </main>;
}
