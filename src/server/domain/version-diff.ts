import type { AgentManifest } from "@/contracts/manifest";
import { jsonValuesEqual } from "@/server/domain/json-value";

type ChangeSet = { added: string[]; removed: string[]; changed: string[] };

export interface VersionDiff {
  nodes: ChangeSet;
  inputFields: ChangeSet;
  outputFields: ChangeSet;
  workflowSettingsChanged: boolean;
  modelChanged: boolean;
  knowledgeChanged: boolean;
  hasChanges: boolean;
}

function workflowSettings(manifest: AgentManifest) {
  const excluded = new Set(["nodes", "variables", "outputContract", "ui", "id", "versionId"]);
  return Object.fromEntries(
    Object.entries(manifest.workflowSnapshot).filter(([key]) => !excluded.has(key)),
  );
}

function same(left: unknown, right: unknown): boolean {
  return jsonValuesEqual(left, right);
}

function compareNamed<T>(
  before: T[],
  after: T[],
  keyOf: (item: T) => string,
  labelOf: (item: T) => string,
): ChangeSet {
  const previous = new Map(before.map((item) => [keyOf(item), item]));
  const current = new Map(after.map((item) => [keyOf(item), item]));
  const added = [...current].filter(([key]) => !previous.has(key)).map(([, item]) => labelOf(item));
  const removed = [...previous].filter(([key]) => !current.has(key)).map(([, item]) => labelOf(item));
  const changed = [...current].flatMap(([key, item]) => {
    const old = previous.get(key);
    if (!old || same(old, item)) return [];
    const oldLabel = labelOf(old);
    const nextLabel = labelOf(item);
    return [oldLabel === nextLabel ? nextLabel : `${oldLabel} → ${nextLabel}`];
  });
  return { added, removed, changed };
}

export function compareAgentVersions(before: AgentManifest, after: AgentManifest): VersionDiff {
  const nodes = compareNamed(
    Object.values(before.workflowSnapshot.nodes),
    Object.values(after.workflowSnapshot.nodes),
    (node) => node.id,
    (node) => node.title,
  );
  const inputFields = compareNamed(
    before.inputContract.fields,
    after.inputContract.fields,
    (field) => field.name,
    (field) => field.label || field.name,
  );
  const outputFields = compareNamed(
    before.outputContract?.fields ?? [],
    after.outputContract?.fields ?? [],
    (field) => field.path,
    (field) => field.label || field.path,
  );
  const workflowSettingsChanged = !same(workflowSettings(before), workflowSettings(after));
  const modelChanged = !same(before.resourceSelection.model, after.resourceSelection.model);
  const knowledgeChanged = !same([...before.knowledgeSnapshot].sort(), [...after.knowledgeSnapshot].sort());
  const hasChanges = [nodes, inputFields, outputFields]
    .some((group) => group.added.length + group.removed.length + group.changed.length > 0)
    || workflowSettingsChanged
    || modelChanged
    || knowledgeChanged;
  return { nodes, inputFields, outputFields, workflowSettingsChanged, modelChanged, knowledgeChanged, hasChanges };
}
