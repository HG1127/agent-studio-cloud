// 创建助手的纯 domain 管道：意图文本 → 编译 → 业务落地门禁 → 复杂意图契约 → 设计审计。
// 只做纯计算，不碰数据库；Server Action 是薄封装。创建页业务蓝图写入意图文本，
// 这里把蓝图中的触发、输入与交付要求收敛为可执行契约。
// 发布侧纯函数也在此文件：stableStringify / buildManifest（env 由 Server Action 读取后经参数传入）。
import { createHash } from "node:crypto";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowDraft } from "@/contracts/workflow";
import { attachComplexIntentContract, compileIntentWorkflow, type IntentStep } from "@/server/domain/intent";
import { groundBusinessWorkflow } from "@/server/domain/grounding";
import { auditWorkflow, type AuditIssue, type DesignAuditResult } from "@/server/domain/audit";
import { applySafeAuditFixes } from "@/server/domain/audit/safe-audit-fixes";

export interface AgentDraftAuditSummary {
  status: DesignAuditResult["status"];
  score: number;
  counts: DesignAuditResult["counts"];
}

export interface AgentDraftDiagnostics {
  error?: string;
  audit?: AgentDraftAuditSummary;
}

export interface AgentPipelineResult {
  draft: WorkflowDraft | null;
  issues: AuditIssue[];
  diagnostics: AgentDraftDiagnostics;
}

interface AgentBlueprint {
  trigger: string | null;
  inputs: string[];
  outputs: string[];
}

function blueprintValue(intentText: string, label: string): string | null {
  const match = new RegExp(`(?:^|\\n)${label}[：:]\\s*([^\\n]+)`).exec(intentText);
  return match?.[1]?.trim().replace(/[。；;]+$/, "").slice(0, 500) || null;
}

function blueprintLabels(value: string | null): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(/[、,，/]+/)
        .map((label) => label.trim().slice(0, 200))
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

function parseAgentBlueprint(intentText: string): AgentBlueprint {
  return {
    trigger: blueprintValue(intentText, "触发条件"),
    inputs: blueprintLabels(blueprintValue(intentText, "需要的业务输入")),
    outputs: blueprintLabels(blueprintValue(intentText, "最终交付")),
  };
}

function removeLinearNode(draft: WorkflowDraft, nodeId: string): void {
  const removed = draft.nodes[nodeId];
  if (!removed) return;
  const replacement = removed.next;
  const replace = (target: string | null | undefined): string | null | undefined => target === nodeId ? replacement : target;
  for (const node of Object.values(draft.nodes)) {
    if (node.id === nodeId) continue;
    node.next = replace(node.next) ?? null;
    node.rejectNext = replace(node.rejectNext) ?? null;
    node.onErrorNext = replace(node.onErrorNext) ?? null;
    if (node.condition) {
      node.condition.defaultNext = replace(node.condition.defaultNext) ?? null;
      for (const branch of node.condition.branches) branch.next = replace(branch.next) ?? null;
    }
    if (node.loop) {
      node.loop.bodyNext = replace(node.loop.bodyNext) ?? null;
      node.loop.exitNext = replace(node.loop.exitNext) ?? null;
    }
    if (node.wait) node.wait.onTimeoutNext = replace(node.wait.onTimeoutNext) ?? null;
  }
  if (draft.startNodeId === nodeId && replacement) draft.startNodeId = replacement;
  delete draft.nodes[nodeId];
  if (draft.ui?.positions) delete draft.ui.positions[nodeId];
}

function applyBlueprintStructure(draft: WorkflowDraft, blueprint: AgentBlueprint): string | null {
  if (blueprint.trigger || blueprint.inputs.length > 0) {
    const trigger = draft.nodes[draft.startNodeId] ?? Object.values(draft.nodes).find((node) => node.type === "trigger");
    if (trigger?.type === "trigger") {
      if (blueprint.trigger) trigger.title = blueprint.trigger.slice(0, 200);
      trigger.description = [
        blueprint.trigger ? `触发条件：${blueprint.trigger}` : null,
        blueprint.inputs.length > 0 ? `需要的业务输入：${blueprint.inputs.join("、")}` : null,
      ].filter(Boolean).join("\n");
    }
  }

  const removable = Object.values(draft.nodes)
    .filter((node) => /^(?:触发条件|需要的业务输入|的业务输入)[：:]/.test(node.title.trim()))
    .map((node) => node.id);
  for (const nodeId of removable) removeLinearNode(draft, nodeId);

  const outputNode = Object.values(draft.nodes).find((node) => /^最终交付[：:]/.test(node.title.trim()));
  if (outputNode && blueprint.outputs.length > 0) {
    const description = blueprint.outputs.join("、");
    outputNode.type = "ai";
    outputNode.title = `生成${description}`.slice(0, 200);
    outputNode.description = `根据前序处理结果生成最终交付：${description}`;
    outputNode.purpose = outputNode.description;
    outputNode.modelClass ||= "default";
    outputNode.ui = { visibility: "business" };
    delete outputNode.system;
    delete outputNode.rule;
    delete outputNode.controlPlane;
    return outputNode.id;
  }

  const candidates = Object.values(draft.nodes).filter((node) =>
    node.ui?.visibility !== "control"
    && !["trigger", "end", "human", "condition", "rule", "wait"].includes(node.type),
  );
  return candidates.at(-1)?.id ?? null;
}

function applyBlueprintInputs(draft: WorkflowDraft, labels: string[]): void {
  if (labels.length === 0) return;
  const names = new Set(draft.variables.map((variable) => variable.name));
  for (const [index, label] of labels.entries()) {
    let suffix = index + 1;
    let name = `input_${suffix}`;
    while (names.has(name)) {
      suffix += 1;
      name = `input_${suffix}`;
    }
    names.add(name);
    draft.variables.push({ name, label, type: "string", scope: "run", required: true });
  }
}

export function buildAgentDraft(options: { name: string; intentText: string; capabilities?: unknown[] }): AgentPipelineResult {
  const { name, intentText } = options;
  try {
    const compiled = compileIntentWorkflow({ text: intentText, name, caps: options.capabilities ?? [], humanReasons: [], sourceType: "idea" });
    return finalizeAgentDraft({ name, intentText, workflow: compiled.workflow, orderedSteps: compiled.orderedSteps });
  } catch (error) {
    return { draft: null, issues: [], diagnostics: { error: error instanceof Error ? error.message : String(error) } };
  }
}

export function finalizeAgentDraft(params: {
  name: string;
  intentText: string;
  workflow: WorkflowDraft;
  orderedSteps: IntentStep[];
}): AgentPipelineResult {
  const { intentText, workflow, orderedSteps } = params;
  try {
    bindDemoCapabilities(workflow);
    const blueprint = parseAgentBlueprint(intentText);
    const outputSourceId = applyBlueprintStructure(workflow, blueprint);
    applyBlueprintInputs(workflow, blueprint.inputs);
    const intent = { orderedSteps, trigger: undefined, outputs: [] };
    const grounded = groundBusinessWorkflow(workflow, {
      sourceText: intentText,
      intent,
      answers: {},
    });
    const enriched = attachComplexIntentContract(grounded, intent, intentText);
    const enrichedWithBlueprint = blueprint.outputs.length > 0 && outputSourceId && enriched.nodes[outputSourceId]
      ? {
        ...enriched,
        outputContract: {
        fields: blueprint.outputs.map((label, index) => ({
          path: `output_${index + 1}`,
          label,
          required: true,
          sourceNodeId: outputSourceId,
        })),
        },
      }
      : enriched;
    // parse 在此补全默认值并把形状收敛到契约——入库与后续画布都消费契约形状，不落原始结构
    const parsedDraft = WorkflowDraft.parse(enrichedWithBlueprint);
    const draft = applySafeAuditFixes(parsedDraft, {
      codes: new Set(["output_contract_missing", "end_without_delivery"]),
    }).draft;
    const audit = auditWorkflow(draft);
    return {
      draft,
      issues: audit.issues,
      diagnostics: { audit: { status: audit.status, score: audit.score, counts: audit.counts } },
    };
  } catch (error) {
    // 编译链对个别输入可能抛错（validate-only parse 与旧 TypeError 路径），统一转为可读诊断
    return {
      draft: null,
      issues: [],
      diagnostics: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

// 创建期能力裁定：编译器对未注册工具标记为 unbound；已配置的真实工具保持原绑定，
// 其余节点明确改绑到界面可见的演示工具，保证演示流程可运行且不伪装成真实外部调用。
// 通用知识步骤同样绑定演示资料库；运行前仍会校验真实注册项是否存在。
export function bindDemoCapabilities(workflow: WorkflowDraft): void {
  for (const node of Object.values(workflow.nodes)) {
    if (
      node.type === "tool" &&
      node.tool &&
      (node.tool.unresolved === true || node.tool.registryToolId == null || node.tool.protocol === "unbound")
    ) {
      // connector/scope 必须一并改绑：executableTool 还要求 connector!=='unbound' 且 scope 不以 unbound. 开头
      node.tool.registryToolId = "demo";
      node.tool.protocol = "demo";
      node.tool.unresolved = false;
      if (node.tool.connector === "unbound") node.tool.connector = "demo";
      if (/^unbound\./.test(node.tool.scope)) node.tool.scope = "demo";
    }
    if (node.type === "knowledge" && node.knowledge && /^(业务知识库|knowledge|知识库)?$/i.test(node.knowledge.space)) {
      node.knowledge.space = "演示资料库";
    }
  }
  const requirements = (workflow.runtimeRequirements ??= { externalTools: [], unresolvedTools: [], toolReceiptVerification: true });
  requirements.unresolvedTools = [];
}

// 控制面节点可能因标题像目标声明而被业务审计误报；仅对明确隐藏的控制节点豁免。
// 最终交付物与结束前交付步骤已有确定性自动补全，不再允许带着这两类关键缺口发布。
const PUBLISH_EXEMPT_CODES: ReadonlySet<string> = new Set(["meta_node_detected"]);

function isControlDraftNode(nodeId: string | null, draft: WorkflowDraft): boolean {
  if (!nodeId) return false;
  const node = draft.nodes[nodeId];
  return node?.ui?.visibility === "control" || node?.controlPlane?.hiddenByDefault === true;
}

export function filterPublishBlockers(issues: AuditIssue[], draft: WorkflowDraft): { blocking: AuditIssue[]; exempted: AuditIssue[] } {
  const blocking: AuditIssue[] = [];
  const exempted: AuditIssue[] = [];
  for (const issue of issues) {
    // 只有 critical 参与裁决：warning/info 本就不拦发布，也不进豁免提醒
    if (issue.severity !== "critical") continue;
    const exempt = PUBLISH_EXEMPT_CODES.has(issue.code) && isControlDraftNode(issue.nodeId, draft);
    (exempt ? exempted : blocking).push(issue);
  }
  return { blocking, exempted };
}

// 指纹要求同一草稿在不同键序下产出同一序列化：递归排序对象键；undefined 字段按 JSON 规则丢弃
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export type ManifestAuditStatus = AgentManifest["designAudit"]["status"];

// manifest 里的审计状态按问题计数推导（旧系统 status 是 blocked/review/ready，语义不同不沿用）
export function deriveDesignAuditStatus(counts: { critical: number; warning: number }): ManifestAuditStatus {
  if (counts.critical > 0) return "blocked";
  if (counts.warning > 0) return "passed_with_warnings";
  return "passed";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function inputContractFor(draft: WorkflowDraft): AgentManifest["inputContract"] {
  const fields: AgentManifest["inputContract"]["fields"] = [];
  const seen = new Set<string>();
  const inputTypes = new Set<AgentManifest["inputContract"]["fields"][number]["type"]>(["string", "number", "boolean", "object", "array"]);
  const addInputSource = (
    source: string | null | undefined,
    type: AgentManifest["inputContract"]["fields"][number]["type"],
  ) => {
    const prefix = source?.startsWith("input.")
      ? "input."
      : source?.startsWith("variables.")
        ? "variables."
        : null;
    if (!source || !prefix) return;
    const path = source.slice(prefix.length).split(".").filter(Boolean);
    const name = path[0];
    if (!name || seen.has(name)) return;
    seen.add(name);
    fields.push({ name, required: true, type: path.length > 1 ? "object" : type });
  };
  const comparisonType = (
    operator: string,
    value: unknown,
  ): AgentManifest["inputContract"]["fields"][number]["type"] => {
    if (["gt", "gte", "lt", "lte"].includes(operator) || typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (Array.isArray(value)) return "array";
    if (value !== null && typeof value === "object") return "object";
    return "string";
  };
  for (const variable of draft.variables ?? []) {
    if (
      variable.scope !== "run"
      || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name)
      || seen.has(variable.name)
      || !inputTypes.has(variable.type as AgentManifest["inputContract"]["fields"][number]["type"])
    ) continue;
    seen.add(variable.name);
    fields.push({
      name: variable.name,
      label: variable.label,
      required: variable.required,
      type: variable.type as AgentManifest["inputContract"]["fields"][number]["type"],
    });
  }
  for (const node of Object.values(draft.nodes)) {
    if (node.type === "condition" && node.condition) {
      const directBranch = node.condition.branches.find((branch) => !branch.rules?.length);
      if (directBranch) {
        addInputSource(node.condition.source, comparisonType(node.condition.operator, directBranch.value));
      }
      for (const rule of node.condition.branches.flatMap((branch) => branch.rules ?? [])) {
        addInputSource(rule.source, comparisonType(rule.operator, rule.value));
      }
    }
    if (node.type === "loop") {
      const collectionPath = node.loop?.collectionPath;
      const fallbackInputPath = collectionPath?.startsWith("context.")
        && !collectionPath.startsWith("context.outputs.")
        && !collectionPath.startsWith("context.currentItem.")
        ? `input.${collectionPath.slice("context.".length)}`
        : collectionPath;
      addInputSource(fallbackInputPath, "array");
    }
  }
  if (fields.length === 0) {
    fields.push({ name: "input", label: "业务输入", required: true, type: "string" });
  }
  return { fields };
}

export function buildManifest(
  draft: WorkflowDraft,
  options: { modelId: string; mock: boolean; connectionId: string | null; knowledgeSnapshot: string[] },
): AgentManifest {
  const audit = auditWorkflow(draft);
  return AgentManifest.parse({
    schemaVersion: "4.0",
    workflowSnapshot: draft,
    workflowFingerprint: createHash("sha256").update(stableStringify(draft)).digest("hex"),
    inputContract: inputContractFor(draft),
    outputContract: draft.outputContract ?? { fields: [] },
    requirementCoverage: asRecord(audit.requirementCoverage),
    complexityProfile: asRecord(audit.complexityProfile),
    resourceSelection: { model: { modelId: options.modelId, mock: options.mock, connectionId: options.connectionId ?? null } },
    knowledgeSnapshot: options.knowledgeSnapshot,
    designAudit: {
      status: deriveDesignAuditStatus(audit.counts),
      issueCount: audit.issues.length,
      criticalCount: audit.counts.critical,
    },
  });
}
