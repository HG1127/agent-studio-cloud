import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { PageRefreshButton } from "@/components/ui/PageRefreshButton";
import { ExternalConnectionBoundary } from "@/features/connections/ExternalConnectionBoundary";
import { McpToolFieldPanel } from "@/features/connections/McpToolFieldPanel";
import { McpConfigurationStatus } from "@/features/connections/McpConfigurationStatus";
import { McpWorkspace } from "@/features/connections/McpWorkspace";
import { McpToolUseGuide } from "@/features/connections/McpToolUseGuide";
import { AgentTargetOption } from "@/contracts/agent";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
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
  let targets: AgentTargetOption[] | null = null;
  try {
    targets = await withSafeQueryError(async () => {
      const { listAgentTargets } = await import("@/server/queries/agents");
      const options = AgentTargetOption.array().parse(await listAgentTargets(DEMO_WORKSPACE_ID, ""));
      if (new Set(options.map((target) => target.versionId.toLowerCase())).size !== options.length) throw new Error("invalid agent targets");
      return options;
    }, "connection-tool-use-targets");
  } catch { targets = null; }
  return <main className="page-shell">
    <PageHeader eyebrow="业务资源" title="外部工具连接" description="核对真实登记与连接状态，也可先整理新连接和工具使用边界；设计草稿不等于已连接或已授权。"
      action={<><PageRefreshButton /><Link href="/knowledge" className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">返回资料与应用</Link></>} />
    <McpWorkspace registered={<>
      <ExternalConnectionBoundary registeredCount={tools?.length ?? null} />
      <McpConfigurationStatus />
      <McpToolFieldPanel tools={tools} readScope={crypto.randomUUID()} />
    </>} usage={<McpToolUseGuide tools={tools} targets={targets} />} />
  </main>;
}
