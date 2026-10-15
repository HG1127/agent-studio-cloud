import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";
import type { ToolRegistration } from "@/server/tools/tool-registry";
import { mcpToolInputDefinitionIssue, mcpToolLocalOutputDefinitionIssue } from "@/server/domain/runtime/mcp-tool";

type ToolSnapshot = NonNullable<WorkflowNode["tool"]>;

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  });
}

export function toolRegistrationCompatibilityIssue(
  snapshot: ToolSnapshot,
  registration: ToolRegistration,
): string | null {
  if (
    snapshot.registryToolId !== registration.id
    || snapshot.protocol !== (registration.protocol ?? "http-json")
    || registration.protocol === "mcp-streamable-http" && snapshot.operationKind !== registration.operationKind
    || snapshot.action !== registration.action
    || snapshot.scope !== registration.scope
    || snapshot.risk !== registration.risk
  ) {
    return "绑定的业务工具配置已变化，请重新发布助手";
  }
  if (registration.protocol === "mcp-streamable-http") {
    const issue = mcpToolInputDefinitionIssue(snapshot.inputSchema) ?? mcpToolInputDefinitionIssue(registration.inputSchema)
      ?? mcpToolLocalOutputDefinitionIssue(snapshot.outputSchema) ?? mcpToolLocalOutputDefinitionIssue(registration.outputSchema);
    if (issue) return issue;
  }
  if (canonicalJson(snapshot.inputSchema) !== canonicalJson(registration.inputSchema)
    || canonicalJson(snapshot.outputSchema) !== canonicalJson(registration.outputSchema)) {
    return "绑定的业务工具配置已变化，请重新发布助手";
  }
  return null;
}

function toolNodeRegistrationIssue(
  node: WorkflowNode,
  getRegistration: (id: string | null | undefined) => ToolRegistration | null,
): string | null {
  const tool = node.tool;
  if (!tool || tool.unresolved === true) return "工具尚未绑定";
  if (tool.protocol === "demo") return null;
  const registration = getRegistration(tool.registryToolId);
  if (!registration) return "绑定的业务工具未在服务端配置";
  if (node.toolOperation && (registration.businessIdempotency !== true || !registration.businessIdempotencyRetentionMs)) return "绑定的业务工具尚未确认支持跨运行操作防重";
  return toolRegistrationCompatibilityIssue(tool, registration);
}

export function workflowToolRegistrationIssue(
  draft: WorkflowDraft,
  getRegistration: (id: string | null | undefined) => ToolRegistration | null,
): string | null {
  const check = (node: WorkflowNode, label: string) => {
    if (node.type !== "tool") return null;
    const issue = toolNodeRegistrationIssue(node, getRegistration);
    return issue ? `步骤「${label}」${issue}` : null;
  };
  for (const node of Object.values(draft.nodes)) {
    const directIssue = check(node, node.title);
    if (directIssue) return directIssue;
    if (node.type === "parallel") {
      const prepared = prepareParallelBranches(node);
      if (prepared.ok) {
        for (const branch of prepared.branches) {
          for (const step of branch.steps) {
            const issue = check(step, `${node.title} / ${branch.label} / ${step.title}`);
            if (issue) return issue;
          }
        }
      }
    }
    if (node.type === "subflow") {
      const prepared = prepareSubflow(node);
      if (prepared.ok) {
        for (const step of prepared.steps) {
          const issue = check(step, `${node.title} / ${step.title}`);
          if (issue) return issue;
        }
      }
    }
  }
  return null;
}
