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
import { getVersionExportSource, listVersions } from "@/server/queries/versions";
import { listModelConnections } from "@/server/queries/model-connections";
import { hasRunningEvaluation, listEvaluationCases, listEvaluationRuns } from "@/server/queries/evaluations";
import { listKnowledgeSourcesForPicker } from "@/server/queries/knowledge";
import { workflowKnowledgeSourceIds } from "@/server/domain/runtime/knowledge-snapshot";
import { workflowCollaborationKeys } from "@/server/domain/import-agent";
import { AgentManifest } from "@/contracts/manifest";
import { listToolRegistryOptions } from "@/server/tools/tool-registry";
import { pageFromSearchParam } from "@/lib/search-params";
import { withSafeQueryError } from "@/server/security/query-error";
import { z } from "zod";
import { Download, ArrowLeft, CheckCircle2, FlaskConical, Layers3, Play, Rocket, ShieldCheck, Workflow } from "lucide-react";

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
  const selectedCollaborationVersionIds = detail.draft
    ? workflowCollaborationKeys(detail.draft).map((key) => key.slice(key.lastIndexOf(":") + 1))
    : [];
  const [versions, latestVersions, connections, agentTargets, evaluationCases, archivedEvaluationCases, evaluationRunRows, evaluationRunning, knowledgeSources] = await withSafeQueryError(() => Promise.all([
    listVersions(agentId, DEMO_WORKSPACE_ID, { limit: versionPageSize + 1, offset: (versionPage - 1) * versionPageSize }),
    versionPage === 1 ? Promise.resolve([]) : listVersions(agentId, DEMO_WORKSPACE_ID, { limit: 1 }),
    listModelConnections(),
    listAgentTargets(DEMO_WORKSPACE_ID, agentId, selectedCollaborationVersionIds),
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
  const latestVersion = versionPage === 1 ? versions[0] : latestVersions[0];
  const hasEvaluableVersion = latestVersion?.status === "candidate" || Boolean(currentVersion);
  const evaluationVersionId = latestVersion?.status === "candidate" ? latestVersion.id : currentVersion?.id;
  const evaluationVersionSource = evaluationVersionId
    ? await withSafeQueryError(() => getVersionExportSource(agentId, evaluationVersionId, DEMO_WORKSPACE_ID), "evaluation-version")
    : null;
  const evaluationManifest = evaluationVersionSource ? AgentManifest.safeParse(evaluationVersionSource.manifest) : null;
  const currentVersionNumber = currentVersion
    ? versions.find((version) => version.id === currentVersion.id)?.version ?? null
    : null;
  const toolOptions = listToolRegistryOptions();
  const currentManifest = currentVersion ? AgentManifest.safeParse(currentVersion.manifest) : null;
  const inputFields = currentManifest?.success ? currentManifest.data.inputContract.fields : undefined;
  const outputFields = currentManifest?.success ? currentManifest.data.outputContract?.fields : undefined;
  const navigation = [
    { href: "#workflow", label: "流程设计", icon: Workflow },
    { href: "#audit", label: "设计检查", icon: ShieldCheck },
    { href: "#versions", label: "版本发布", icon: Rocket },
    { href: "#evaluation", label: "自动验收", icon: FlaskConical },
    { href: "#run", label: "试运行", icon: Play },
  ];
  return (
    <main className="page-shell max-w-[1480px]">
      <Link href="/agents" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" />返回助手列表
      </Link>
      <header className="content-card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="eyebrow mb-2">助手工作台</p><h1 className="text-2xl font-bold tracking-tight text-slate-950">{detail.agent.name}</h1></div>
          <a href={`/api/agents/${agentId}/export`} download className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"><Download className="size-4" />导出定义</a>
        </div>
        {detail.agent.description ? (
          <p className="text-sm text-gray-500">{detail.agent.description}</p>
        ) : null}
        <AgentMetadataEditor
          key={agentId}
          agentId={agentId}
          initialName={detail.agent.name}
          initialDescription={detail.agent.description}
          initialUpdatedAt={detail.agent.updatedAt.toISOString()}
        />
        <p className="w-fit rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">{auditStatusLine(audit)}</p>
      </header>
      <section aria-label="助手状态摘要" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="content-card flex items-center gap-3 p-4"><span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Layers3 className="size-5" /></span><div><p className="text-xs text-slate-500">流程步骤</p><p className="mt-1 text-xl font-bold text-slate-950">{detail.draft ? Object.keys(detail.draft.nodes).length : 0}</p></div></div>
        <div className="content-card flex items-center gap-3 p-4"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600"><Rocket className="size-5" /></span><div><p className="text-xs text-slate-500">当前版本</p><p className="mt-1 text-xl font-bold text-slate-950">{currentVersionNumber === null ? currentVersion ? "已发布" : "未发布" : `V${currentVersionNumber}`}</p></div></div>
        <div className="content-card flex items-center gap-3 p-4"><span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="size-5" /></span><div><p className="text-xs text-slate-500">启用样例</p><p className="mt-1 text-xl font-bold text-slate-950">{evaluationCases.length}</p></div></div>
        <div className="content-card flex items-center gap-3 p-4"><span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-600"><ShieldCheck className="size-5" /></span><div><p className="text-xs text-slate-500">设计得分</p><p className="mt-1 text-xl font-bold text-slate-950">{audit?.score ?? "—"}</p></div></div>
      </section>
      <nav aria-label="助手工作台分区" className="sticky top-14 z-30 -mx-1 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-sm backdrop-blur">
        {navigation.map((item) => <a key={item.href} href={item.href} className="inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"><item.icon className="size-4" />{item.label}</a>)}
      </nav>
      <section id="workflow" className="scroll-mt-32">
        {detail.draft ? (
          <FlowCanvas key={agentId} agentId={agentId} draft={detail.draft} draftUpdatedAt={detail.draftUpdatedAt} agentTargets={agentTargets} toolOptions={toolOptions}
            knowledgeSources={knowledgeSources} />
        ) : (
          <div className="content-card border-dashed text-center text-sm text-gray-500">
            这个助手还没有流程草稿
          </div>
        )}
      </section>
      {audit ? <DesignAuditPanel key={agentId} agentId={agentId} score={audit.score} issues={AuditIssueView.array().parse(audit.issues)} /> : null}
      <VersionPanel
        key={agentId}
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
        key={agentId}
        agentId={agentId}
        cases={evaluationCases}
        archivedCases={archivedEvaluationCases.slice(0, archivedCasesPageSize)}
        runs={evaluationRunRows.slice(0, evaluationRunsPageSize)}
        evaluationRunning={evaluationRunning}
        hasEvaluableVersion={hasEvaluableVersion}
        runsPage={evaluationRunsPage}
        hasMoreRuns={evaluationRunRows.length > evaluationRunsPageSize}
        archivedPage={archivedCasesPage}
        hasMoreArchived={archivedEvaluationCases.length > archivedCasesPageSize}
        versionsPage={versionPage}
        inputFields={evaluationManifest?.success ? evaluationManifest.data.inputContract.fields : undefined}
        inputVersion={evaluationVersionSource?.version ?? null}
        evaluationVersionId={evaluationVersionId ?? null}
      />
      <RunLauncher
        key={agentId}
        agentId={agentId}
        inputFields={inputFields}
        outputFields={outputFields}
        hasProductionVersion={Boolean(currentVersion)}
        productionVersion={currentVersionNumber}
      />
    </main>
  );
}
