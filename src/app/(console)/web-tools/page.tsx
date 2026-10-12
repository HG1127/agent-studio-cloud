import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { SectionLoadingState } from "@/components/ui/SectionLoadingState";
import { WebToolSources } from "@/features/web-tools/WebToolSources";
import { WebToolTrialResult } from "@/features/web-tools/WebToolTrialResult";
import { webToolNavigation } from "@/features/web-tools/web-tool-navigation";

export const dynamic = "force-dynamic";

export default async function WebToolsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const navigation = webToolNavigation(await searchParams);

  return <main className="page-shell">
    <PageHeader eyebrow="网页交付" title="网页工具" description="核对正式业务字段，并可确认内部试运行；网页发布和外部调用尚未接入。"
      action={<><PageRefreshButton /><Link href="/releases" className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">返回发布中心</Link></>} />
    {navigation.invalid ? <section role="alert" className="content-card border-amber-200 bg-amber-50"><p className="text-sm leading-6 text-amber-950">网址中的版本或运行选择无法核对，未使用该选择，也没有自动打开其他任务。重复选择或仅提供任务而没有版本都会被拦截。</p><Link href="/web-tools" prefetch={false} className="mt-2 inline-block text-sm font-semibold text-indigo-700">清除网址选择，重新核对</Link></section> : <Suspense key={`result:${navigation.state.versionId ?? "none"}:${navigation.state.runId ?? "none"}`} fallback={<SectionLoadingState id="web-tool-run-result" title="正在读取内部运行结果" description="正在核对本次任务及其版本归属，尚未展示交付结果。" />}><WebToolTrialResult navigation={navigation.state} /></Suspense>}
    <Suspense key={`sources:${navigation.invalid ? "invalid" : navigation.state.versionId ?? "current"}`} fallback={<SectionLoadingState id="web-tool-sources" title="正在读取正式版本清单" description="读取真实的正式版本及业务字段，不会自动创建任务或发布网页。" />}><WebToolSources navigation={navigation.state} invalid={navigation.invalid} /></Suspense>
  </main>;
}
