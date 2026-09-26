import Link from "next/link";
import { notFound } from "next/navigation";
import { RunLauncher } from "@/features/agents/RunLauncher";
import { VersionPanel } from "@/features/agents/VersionPanel";
import { EvaluationPanel } from "@/features/agents/EvaluationPanel";
import { AgentMetadataEditor } from "@/features/agents/AgentMetadataEditor";
import { DesignAuditPanel } from "@/features/agents/DesignAuditPanel";
import { AuditIssueView } from "@/contracts/audit";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { auditWorkflow, type DesignAuditResult } from "@/server/domain/audit";
import { getAgentDetail, listAgentTargets } from "@/server/queries/agents";
import { listVersions } from "@/server/queries/versions";
import { listModelConnections } from "@/server/queries/model-connections";
import { hasRunningEvaluation, listEvaluationCases, listEvaluationRuns } from "@/server/queries/evaluations";
import { listKnowledgeSourcesForPicker } from "@/server/queries/knowledge";
import { workflowKnowledgeSourceIds } from "@/server/domain/runtime/knowledge-snapshot";
import { AgentManifest } from "@/contracts/manifest";
import { listToolRegistryOptions } from "@/server/tools/tool-registry";
import { pageFromSearchParam } from "@/lib/search-params";
import { withSafeQueryError } from "@/server/security/query-error";
import { z } from "zod";

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
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ versionsPage?: string; archivedCasesPage?: string; evaluationRunsPage?: string }>;
}) {
  const { agentId } = await params;
  if (!z.string().uuid().safeParse(agentId).success) notFound();
  const query = await searchParams;
  const versionPage = pageFromSearchParam(query.versionsPage);
  const versionPageSize = 50;
  const archivedCasesPage = pageFromSearchParam(query.archivedCasesPage);
  const archivedCasesPageSize = 25;
  const evaluationRunsPage = pageFromSearchParam(query.evaluationRunsPage);
  const evaluationRunsPageSize = 10;
  const detail = await withSafeQueryError(() => getAgentDetail(agentId, DEMO_WORKSPACE_ID), "agent-detail");
  if (!detail) notFound();
  const audit = detail.draft ? auditWorkflow(detail.draft) : null;
  const selectedKnowledgeSourceIds = detail.draft ? workflowKnowledgeSourceIds(detail.draft.nodes) : [];
  const [versions, connections, agentTargets, evaluationCases, archivedEvaluationCases, evaluationRunRows, evaluationRunning, knowledgeSources] = await withSafeQueryError(() => Promise.all([
    listVersions(agentId, DEMO_WORKSPACE_ID, { limit: versionPageSize + 1, offset: (versionPage - 1) * versionPageSize }),
    listModelConnections(),
    listAgentTargets(DEMO_WORKSPACE_ID, agentId),
    listEvaluationCases(agentId, DEMO_WORKSPACE_ID),
    listEvaluationCases(agentId, DEMO_WORKSPACE_ID, {
      archived: true,
      limit: archivedCasesPageSize + 1,
      offset: (archivedCasesPage - 1) * archivedCasesPageSize,
    }),
    listEvaluationRuns(agentId, DEMO_WORKSPACE_ID, {
      limit: evaluationRunsPageSize + 1,
      offset: (evaluationRunsPage - 1) * evaluationRunsPageSize,
    }),
    hasRunningEvaluation(agentId, DEMO_WORKSPACE_ID),
    listKnowledgeSourcesForPicker(selectedKnowledgeSourceIds),
  ]), "agent-detail-related");
  const defaultModelLabel = process.env.MODEL_MOCK === "1" ? "演示模式" : process.env.MODEL_ID?.trim() ? "服务端默认模型" : "尚未配置默认模型";
  const currentVersion = detail.currentVersion;
  const toolOptions = listToolRegistryOptions();
  const currentManifest = currentVersion ? AgentManifest.safeParse(currentVersion.manifest) : null;
  const inputFields = currentManifest?.success ? currentManifest.data.inputContract.fields : undefined;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-8">
      <Link href="/agents" className="w-fit text-sm text-gray-500 hover:text-gray-700">
        ← 返回助手列表
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{detail.agent.name}</h1>
          <a href={`/api/agents/${agentId}/export`} download className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-500">导出定义</a>
        </div>
        {detail.agent.description ? (
          <p className="text-sm text-gray-500">{detail.agent.description}</p>
        ) : null}
        <AgentMetadataEditor
          agentId={agentId}
          initialName={detail.agent.name}
          initialDescription={detail.agent.description}
          initialUpdatedAt={detail.agent.updatedAt.toISOString()}
        />
        <p className="text-sm text-gray-500">{auditStatusLine(audit)}</p>
      </header>
      {detail.draft ? (
        <FlowCanvas agentId={agentId} draft={detail.draft} draftUpdatedAt={detail.draftUpdatedAt} agentTargets={agentTargets} toolOptions={toolOptions}
          knowledgeSources={knowledgeSources} />
      ) : (
        <section className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          这个助手还没有流程草稿
        </section>
      )}
      {audit ? <DesignAuditPanel agentId={agentId} score={audit.score} issues={AuditIssueView.array().parse(audit.issues)} /> : null}
      <VersionPanel
        agentId={agentId}
        versions={versions.slice(0, versionPageSize)}
        connections={connections}
        defaultModelLabel={defaultModelLabel}
        currentVersionId={currentVersion?.id ?? null}
        versionPage={versionPage}
        hasMoreVersions={versions.length > versionPageSize}
        archivedCasesPage={archivedCasesPage}
        evaluationRunsPage={evaluationRunsPage}
      />
      <EvaluationPanel
        agentId={agentId}
        cases={evaluationCases}
        archivedCases={archivedEvaluationCases.slice(0, archivedCasesPageSize)}
        runs={evaluationRunRows.slice(0, evaluationRunsPageSize)}
        evaluationRunning={evaluationRunning}
        runsPage={evaluationRunsPage}
        hasMoreRuns={evaluationRunRows.length > evaluationRunsPageSize}
        archivedPage={archivedCasesPage}
        hasMoreArchived={archivedEvaluationCases.length > archivedCasesPageSize}
        versionsPage={versionPage}
      />
      <RunLauncher agentId={agentId} inputFields={inputFields} />
    </main>
  );
}
