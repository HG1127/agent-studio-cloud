import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { ExternalConnectionBoundary } from "@/features/connections/ExternalConnectionBoundary";
import { McpToolFieldPanel } from "@/features/connections/McpToolFieldPanel";
import { McpConfigurationStatus } from "@/features/connections/McpConfigurationStatus";
import { listToolRegistryOptions } from "@/server/queries/tool-registry";
import { readToolRegistryDefinitions } from "@/features/capabilities/tool-registry-definition";
import { withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  let tools: ReturnType<typeof readToolRegistryDefinitions> = null;
  try {
    tools = await withSafeQueryError(async () => {
      const options = readToolRegistryDefinitions(listToolRegistryOptions());
      if (options === null) throw new Error("invalid tool registry definition");
      return options;
    }, "connection-tool-definitions");
  } catch { tools = null; }
  return <main className="page-shell">
    <PageHeader eyebrow="业务资源" title="外部工具连接" description="区分服务端已登记的业务工具与需要握手、发现和授权的外部连接。"
      action={<><PageRefreshButton /><Link href="/knowledge" className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">返回资料与应用</Link></>} />
    <ExternalConnectionBoundary registeredCount={tools?.length ?? null} />
    <McpConfigurationStatus />
    <McpToolFieldPanel tools={tools} readScope={crypto.randomUUID()} />
  </main>;
}
