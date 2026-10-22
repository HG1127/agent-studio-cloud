import type { AgentManifest } from "@/contracts/manifest";
import type { VersionDiff } from "@/server/domain/version-diff";
import { isCredentialFieldName, redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import type { FrozenResourceBindingsView } from "./frozen-resource-bindings";

const identityKeys = new Set(["id", "modelId", "connectionId", "registryToolId", "agentId", "nodeId", "runId", "workspaceId", "workflowFingerprint", "sourceIds", "knowledgeSnapshot"]);

function comparisonTextFormatter(manifests: AgentManifest[], identifiers: string[]) {
  const hidden = new Set(identifiers.filter(Boolean));
  function collect(input: unknown, sensitive = false) {
    if (typeof input === "string") { if (sensitive && input) hidden.add(input); return; }
    if (Array.isArray(input)) { for (const item of input) collect(item, sensitive); return; }
    if (input !== null && typeof input === "object") {
      for (const [key, item] of Object.entries(input)) collect(item, sensitive || identityKeys.has(key) || isCredentialFieldName(key));
    }
  }
  for (const manifest of manifests) collect(manifest);
  const tokens = [...hidden].sort((left, right) => right.length - left.length);
  return (value: string) => {
    let text = redactSensitiveText(value).replace(/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}/gi, "[内部标识已隐藏]");
    for (const identifier of tokens) text = text.split(identifier).join("[内部标识已隐藏]");
    return text.length > 180 ? text.slice(0, 180) + "…" : text;
  };
}

export function versionComparisonText(value: string, manifests: AgentManifest[], identifiers: string[]): string {
  return comparisonTextFormatter(manifests, identifiers)(value);
}

export function versionComparisonDiffView(diff: VersionDiff, before: AgentManifest, after: AgentManifest, identifiers: string[]): VersionDiff {
  const manifests = [before, after];
  const format = comparisonTextFormatter(manifests, identifiers);
  function changes(group: VersionDiff["nodes"], aliases = new Map<string, string>()) {
    const labels = (values: string[]) => values.map((value) => format(value.split(" → ").map((part) => aliases.get(part) ?? part).join(" → ")));
    return { added: labels(group.added), changed: labels(group.changed), removed: labels(group.removed) };
  }
  const inputAliases = new Map(manifests.flatMap((manifest) => manifest.inputContract.fields.filter((field) => !field.label).map((field) => [field.name, "未命名输入字段"] as const)));
  const outputAliases = new Map(manifests.flatMap((manifest) => (manifest.outputContract?.fields ?? []).filter((field) => !field.label).map((field) => [field.path, "未命名交付字段"] as const)));
  return { ...diff, nodes: changes(diff.nodes), inputFields: changes(diff.inputFields, inputAliases), outputFields: changes(diff.outputFields, outputAliases) };
}

export function comparisonResourceView(view: FrozenResourceBindingsView): FrozenResourceBindingsView {
  return { ...view, steps: view.steps.map((step) => ({ ...step, ownerNodeId: null })) };
}
