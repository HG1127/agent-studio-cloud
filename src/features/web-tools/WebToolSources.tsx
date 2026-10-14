import { SectionReadState } from "@/components/ui/SectionReadState";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { AgentManifest } from "@/contracts/manifest";
import { AgentTargetOption } from "@/contracts/agent";
import { inputDefinitionsForFields } from "@/features/agents/input-field-description";
import { withSafeQueryError } from "@/server/security/query-error";
import { WebToolReadiness } from "./WebToolReadiness";
import { WebToolNavigation } from "./web-tool-navigation";

export async function WebToolSources({ navigation, invalid }: { navigation: WebToolNavigation; invalid: boolean }) {
  const parsedNavigation = WebToolNavigation.safeParse(navigation);
  const valid = !invalid && parsedNavigation.success;
  const explicitVersionId = valid ? parsedNavigation.data.versionId?.toLowerCase() : undefined;
  const targets = await withSafeQueryError(async () => {
    const { listAgentTargets } = await import("@/server/queries/agents");
    const rows = AgentTargetOption.array().parse(await listAgentTargets(DEMO_WORKSPACE_ID, "", explicitVersionId ? [explicitVersionId] : []));
    if (new Set(rows.map((row) => row.versionId)).size !== rows.length) throw new Error("版本清单无法逐项核对");
    return rows;
  }, "web-tool-sources").catch(() => null);
  if (targets === null) return <SectionReadState id="web-tool-sources" title="版本来源清单暂时无法读取" description="没有把读取失败当成没有正式版本。已关联的运行结果可独立读取；当前不能更换来源或发起新的试运行。" />;
  const selectedVersionId = valid ? explicitVersionId ?? targets[0]?.versionId ?? null : null;
  const selected = targets.find((target) => target.versionId === selectedVersionId);
  const source = selected ? await withSafeQueryError(async () => {
    const { getVersionExportSource } = await import("@/server/queries/versions");
    return getVersionExportSource(selected.agentId, selected.versionId, DEMO_WORKSPACE_ID);
  }, "web-tool-input-descriptions").catch(() => null) : null;
  const manifest = selected && source && (source.status === "production" || source.status === "retired") && source.version === selected.version ? AgentManifest.safeParse(source.manifest) : null;
  const verified = manifest?.success && source ? AgentTargetOption.safeParse({
    ...selected, agentName: source.agentName,
    inputContract: manifest.data.inputContract, outputContract: manifest.data.outputContract ?? { fields: [] },
  }) : null;
  const inputDefinitions = verified?.success && manifest?.success ? inputDefinitionsForFields(manifest.data.inputContract.fields, manifest.data.workflowSnapshot.variables) : undefined;
  const currentTargets = verified?.success ? targets.map((target) => target.versionId === selectedVersionId ? verified.data : target) : targets;
  return <WebToolReadiness targets={currentTargets} selectedVersionId={selectedVersionId} sourceStatus={typeof source?.status === "string" ? source.status : null} inputDefinitions={inputDefinitions} descriptionsUnavailable={Boolean(selected) && verified?.success !== true} />;
}
