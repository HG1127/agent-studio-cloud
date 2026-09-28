import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { WebToolReadiness } from "@/features/web-tools/WebToolReadiness";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { firstSearchParam } from "@/lib/search-params";
import { listAgentTargets } from "@/server/queries/agents";
import { withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

export default async function WebToolsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requested = firstSearchParam((await searchParams).version);
  const targets = await withSafeQueryError(() => listAgentTargets(DEMO_WORKSPACE_ID, ""), "web-tool-sources");
  const selectedVersionId = requested ?? targets[0]?.versionId ?? null;

  return <main className="page-shell">
    <PageHeader eyebrow="网页交付" title="网页工具" description="先核对正式版本的真实业务字段；网页发布和外部调用尚未接入。"
      action={<><PageRefreshButton /><Link href="/releases" className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">返回发布中心</Link></>} />
    <WebToolReadiness targets={targets} selectedVersionId={selectedVersionId} />
  </main>;
}
