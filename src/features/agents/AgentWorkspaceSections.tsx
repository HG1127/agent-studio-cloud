import { CheckCircle2, Rocket, type LucideIcon } from "lucide-react";
import type { AgentDetailView } from "@/contracts/agent";
import { AgentManifest } from "@/contracts/manifest";
import { SectionReadState } from "@/components/ui/SectionReadState";
import { VersionPanel } from "./VersionPanel";
import { EvaluationPanel } from "./EvaluationPanel";
import type { EvaluationReviewNavigation } from "./evaluation-review-navigation";
import { RunLauncher } from "./RunLauncher";
import { inputDefinitionsForFields } from "./input-field-description";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { listAgentTargets } from "@/server/queries/agents";
import { getVersionExportSource, listVersions } from "@/server/queries/versions";
import { listModelConnections } from "@/server/queries/model-connections";
import { hasRunningEvaluation, listEvaluationCases, listEvaluationRuns } from "@/server/queries/evaluations";
import { listKnowledgeSourcesForPicker } from "@/server/queries/knowledge";
import { listToolRegistryOptions } from "@/server/queries/tool-registry";
import { workflowKnowledgeSourceIds } from "@/server/domain/runtime/knowledge-snapshot";
import { workflowCollaborationKeys } from "@/server/domain/import-agent";
import { withSafeQueryError } from "@/server/security/query-error";

async function readSection<T>(query: () => Promise<T>, label: string): Promise<T | null> {
  try { return await withSafeQueryError(query, label); } catch { return null; }
}

export function AgentWorkspaceSummaryCard({ title, value, icon: Icon, tone }: {
  title: string; value: string | number; icon: LucideIcon; tone: string;
}) {
  return <div className="content-card flex items-center gap-3 p-4"><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone}`}><Icon aria-hidden className="size-5" /></span><div><p className="text-xs text-slate-500">{title}</p><p className="mt-1 text-xl font-bold text-slate-950">{value}</p></div></div>;
}

export function loadAgentWorkspaceSections(detail: AgentDetailView, pages: {
  versionPage: number; archivedCasesPage: number; evaluationRunsPage: number;
  reviewNavigation?: EvaluationReviewNavigation; invalidReviewNavigation?: boolean;
}) {
  const agentId = detail.agent.id;
  const { versionPage, archivedCasesPage, evaluationRunsPage } = pages;
  const versionPageSize = 50;
  const archivedCasesPageSize = 25;
  const evaluationRunsPageSize = 10;
  const currentVersion = detail.currentVersion;
  const currentManifest = currentVersion ? AgentManifest.safeParse(currentVersion.manifest) : null;
  const knowledgeIds = detail.draft ? workflowKnowledgeSourceIds(detail.draft.nodes) : [];
  const collaborationVersions = detail.draft ? workflowCollaborationKeys(detail.draft).map((key) => key.slice(key.lastIndexOf(":") + 1)) : [];

  // 仅共享本次页面读取的 Promise，不缓存跨请求的业务状态。
  const versions = readSection(() => listVersions(agentId, DEMO_WORKSPACE_ID, { limit: versionPageSize + 1, offset: (versionPage - 1) * versionPageSize }), "agent-versions");
  const latestVersions = versionPage === 1 ? Promise.resolve([]) : readSection(() => listVersions(agentId, DEMO_WORKSPACE_ID, { limit: 1 }), "agent-latest-version");
  const connections = readSection(() => listModelConnections(), "agent-model-connections");
  const targets = readSection(() => listAgentTargets(DEMO_WORKSPACE_ID, agentId, collaborationVersions), "agent-collaboration-options");
  const cases = readSection(() => listEvaluationCases(agentId, DEMO_WORKSPACE_ID), "agent-evaluation-cases");
  const archivedCases = readSection(() => listEvaluationCases(agentId, DEMO_WORKSPACE_ID, { archived: true, limit: archivedCasesPageSize + 1, offset: (archivedCasesPage - 1) * archivedCasesPageSize }), "agent-archived-cases");
  const runs = readSection(() => listEvaluationRuns(agentId, DEMO_WORKSPACE_ID, { limit: evaluationRunsPageSize + 1, offset: (evaluationRunsPage - 1) * evaluationRunsPageSize }), "agent-evaluation-runs");
  const latestRuns = evaluationRunsPage === 1 ? Promise.resolve([]) : readSection(() => listEvaluationRuns(agentId, DEMO_WORKSPACE_ID, { limit: 1 }), "agent-latest-evaluation");
  const running = readSection(() => hasRunningEvaluation(agentId, DEMO_WORKSPACE_ID), "agent-evaluation-running");
  const knowledge = readSection(() => listKnowledgeSourcesForPicker(knowledgeIds), "agent-knowledge-options");
  const tools = readSection(async () => listToolRegistryOptions(), "agent-tool-options");
  const versionNumber = versions.then((rows) => currentVersion ? rows?.find((version) => version.id === currentVersion.id)?.version ?? null : null);

  const evaluationVersion = Promise.all([versions, latestVersions]).then(async ([rows, latest]) => {
    const known = rows !== null && latest !== null;
    const recent = versionPage === 1 ? rows?.[0] : latest?.[0];
    const hasVersion = recent?.status === "candidate" || Boolean(currentVersion);
    const id = recent?.status === "candidate" ? recent.id : currentVersion?.id;
    const source = known && id ? await readSection(() => getVersionExportSource(agentId, id, DEMO_WORKSPACE_ID), "evaluation-version") : null;
    const manifest = source ? AgentManifest.safeParse(source.manifest) : null;
    return { known, hasVersion, id, source, manifest, contractKnown: !hasVersion || manifest?.success === true };
  });

  return {
    versionSummary: versionNumber.then((number) => <AgentWorkspaceSummaryCard title="当前版本" value={number === null ? currentVersion ? "已发布" : "未发布" : `V${number}`} icon={Rocket} tone="bg-blue-50 text-blue-600" />),
    caseSummary: cases.then((rows) => <AgentWorkspaceSummaryCard title={rows === null ? "启用样例 · 暂不可读" : "启用样例"} value={rows?.length ?? "—"} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-600" />),
    workflow: Promise.all([targets, knowledge, tools]).then(([agentTargets, knowledgeSources, toolOptions]) => detail.draft
      ? agentTargets !== null && knowledgeSources !== null && toolOptions !== null
        ? <FlowCanvas key={agentId} agentId={agentId} draft={detail.draft} draftUpdatedAt={detail.draftUpdatedAt} agentTargets={agentTargets} knowledgeSources={knowledgeSources} toolOptions={toolOptions} />
        : <SectionReadState id="workflow-read" title="流程资源暂时无法读取" description="流程草稿已读取，但资料、工具或协作助手清单尚未读全。为避免把失效读取当成未绑定资源，画布编辑暂不开放；草稿没有被改动。" />
      : <SectionReadState id="workflow-read" title="暂无可编辑的流程草稿" description="当前没有读到有效草稿，可能尚未保存，也可能未通过读取校验。不能据此判断流程有零个步骤；可重新读取，或核对已发布版本的定义。" />),
    publication: Promise.all([versions, connections]).then(([rows, modelConnections]) => rows !== null && modelConnections !== null
      ? <VersionPanel key={agentId} agentId={agentId} versions={rows.slice(0, versionPageSize)} connections={modelConnections}
        defaultModelLabel={process.env.MODEL_MOCK === "1" ? "演示模式" : process.env.MODEL_ID?.trim() ? "服务端默认模型" : "尚未配置默认模型"}
        currentVersionId={currentVersion?.id ?? null} versionPage={versionPage} hasMoreVersions={rows.length > versionPageSize} archivedCasesPage={archivedCasesPage} evaluationRunsPage={evaluationRunsPage} />
      : <SectionReadState id="versions" title="版本发布暂时无法读取" description="版本历史或模型连接清单暂时无法读取。现在不能核对发布和恢复所需信息，因此暂停这些操作，不会把未知状态当成未发布。" />),
    evaluation: Promise.all([evaluationVersion, cases, archivedCases, runs, latestRuns, running]).then(([version, active, archived, history, recent, isRunning]) => version.known && version.contractKnown && active !== null && archived !== null && history !== null && recent !== null && isRunning !== null
      ? <EvaluationPanel key={agentId} agentId={agentId} cases={active} archivedCases={archived.slice(0, archivedCasesPageSize)} runs={history.slice(0, evaluationRunsPageSize)} latestRun={evaluationRunsPage === 1 ? history[0] ?? null : recent[0] ?? null}
        evaluationRunning={isRunning} hasEvaluableVersion={version.hasVersion} runsPage={evaluationRunsPage} hasMoreRuns={history.length > evaluationRunsPageSize} archivedPage={archivedCasesPage} hasMoreArchived={archived.length > archivedCasesPageSize} versionsPage={versionPage}
        inputFields={version.manifest?.success ? version.manifest.data.inputContract.fields : undefined} inputVersion={version.source?.version ?? null} evaluationVersionId={version.id ?? null} reviewNavigation={pages.reviewNavigation} invalidReviewNavigation={pages.invalidReviewNavigation} />
      : <SectionReadState id="evaluation" title="自动验收暂时无法读取" description="验收样例、运行记录、进行中状态或对应版本的业务字段尚未读全。当前无法安全核对验收对象和重复提交，因此暂停样例修改与新一轮验收；已有任务不会因此停止。" />),
    launcher: versionNumber.then((number) => <RunLauncher key={agentId} agentId={agentId} sourceRefreshPolicy="preserve-active" sourceUnavailable={Boolean(currentVersion) && currentManifest?.success !== true} productionVersionId={currentVersion?.id ?? null} inputFields={currentManifest?.success ? currentManifest.data.inputContract.fields : undefined} inputDefinitions={currentManifest?.success ? inputDefinitionsForFields(currentManifest.data.inputContract.fields, currentManifest.data.workflowSnapshot.variables) : undefined} outputFields={currentManifest?.success ? currentManifest.data.outputContract?.fields : undefined} hasProductionVersion={Boolean(currentVersion)} productionVersion={number} />),
  };
}
