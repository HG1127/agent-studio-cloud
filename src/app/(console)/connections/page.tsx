import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { ToolCatalog } from "@/features/capabilities/ToolCatalog";
import { ExternalConnectionBoundary } from "@/features/connections/ExternalConnectionBoundary";
import { listVisibleToolRegistry } from "@/server/queries/tool-registry";

export const dynamic = "force-dynamic";

export default function ConnectionsPage() {
  const tools = listVisibleToolRegistry();
  return <main className="page-shell">
    <PageHeader eyebrow="业务资源" title="外部工具连接" description="区分服务端已登记的业务工具与需要握手、发现和授权的外部连接。"
      action={<><PageRefreshButton /><Link href="/knowledge" className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">返回资料与应用</Link></>} />
    <ExternalConnectionBoundary registeredCount={tools.length} />
    <ToolCatalog tools={tools} />
  </main>;
}
