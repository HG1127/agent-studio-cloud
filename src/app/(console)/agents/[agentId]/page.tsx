import Link from "next/link";
import { notFound } from "next/navigation";
import { RunLauncher } from "@/features/agents/run-launcher";
import { VersionPanel } from "@/features/agents/version-panel";
import { FlowCanvas } from "@/features/workflow-canvas/flow-canvas";
import { auditWorkflow, type DesignAuditResult } from "@/server/domain/audit";
import { getAgentDetail } from "@/server/queries/agents";
import { listVersions } from "@/server/queries/versions";

export const dynamic = "force-dynamic";

// 审计摘要只在服务端渲染成一行文案，不把审计对象传给客户端，因此无需新增跨端契约
function auditStatusLine(audit: DesignAuditResult | null): string {
  if (!audit) return "设计检查：暂时无法获取";
  if (audit.status === "blocked") return `设计检查：未通过（${audit.counts.critical} 个阻塞）`;
  if (audit.status === "review") {
    return `设计检查：待复核（${audit.counts.warning + audit.counts.info} 个建议）`;
  }
  return "设计检查：通过";
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const detail = await getAgentDetail(agentId);
  if (!detail) notFound();
  const audit = detail.draft ? auditWorkflow(detail.draft) : null;
  const versions = await listVersions(agentId);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-8">
      <Link href="/agents" className="w-fit text-sm text-gray-500 hover:text-gray-700">
        ← 返回助手列表
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{detail.agent.name}</h1>
        {detail.agent.description ? (
          <p className="text-sm text-gray-500">{detail.agent.description}</p>
        ) : null}
        <p className="text-sm text-gray-500">{auditStatusLine(audit)}</p>
      </header>
      {detail.draft ? (
        <FlowCanvas agentId={agentId} draft={detail.draft} />
      ) : (
        <section className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          这个助手还没有流程草稿
        </section>
      )}
      <VersionPanel agentId={agentId} versions={versions} />
      <RunLauncher agentId={agentId} />
    </main>
  );
}
