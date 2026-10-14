export const RESOURCE_SOURCE_A = "00000000-0000-4000-8000-000000000041";
export const RESOURCE_SOURCE_B = "00000000-0000-4000-8000-000000000042";
export const RESOURCE_CONNECTION = "00000000-0000-4000-8000-000000000043";
export const RESOURCE_TOOL = "catalog-tool-private-7";
export const RESOURCE_MODEL = "model-private-8";

export function frozenResourceManifest() {
  return {
    schemaVersion: "4.0",
    workflowFingerprint: "declared-only-fingerprint",
    inputContract: { fields: [] },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    resourceSelection: { model: { modelId: RESOURCE_MODEL } },
    knowledgeSnapshot: [RESOURCE_SOURCE_A],
    workflowSnapshot: {
      id: "frozen-resource-flow",
      rootAgent: { id: "resource-owner", name: "业务助手", role: "核对" },
      memoryPolicy: { taskContext: false, longTerm: false },
      nodes: {
        knowledge_step: {
          id: "knowledge_step", title: "查询办理资料", type: "knowledge",
          knowledge: { space: "办理规范", sourceIds: [RESOURCE_SOURCE_A], selectionRequired: false },
        },
        tool_step: {
          id: "tool_step", title: "查询办理进度", type: "tool",
          tool: resourceTool(),
        },
        ai_step: { id: "ai_step", title: "整理答复", type: "ai" },
        group_step: {
          id: "group_step", title: "整理资料", type: "subflow",
          subflow: {
            name: "资料整理",
            steps: [{ id: "inline_lookup", title: "组内查询", type: "knowledge", knowledge: { space: "归档规范", sourceIds: [RESOURCE_SOURCE_A] } }],
          },
        },
        parallel_step: {
          id: "parallel_step", title: "同步核对", type: "parallel",
          parallel: { strategy: "all", failurePolicy: "continue", branches: [
            { id: "receipt_branch", label: "回执核对", steps: [{ id: "inline_tool", title: "组内工具", type: "tool", tool: resourceTool() }] },
            { id: "reply_branch", label: "答复核对", steps: [{ id: "inline_ai", title: "组内答复", type: "ai" }] },
          ] },
        },
      },
    },
  };
}

export function resourceTool() {
  return { connector: "connector-private", action: "action-private", scope: "scope-private", protocol: "protocol-private", registryToolId: RESOURCE_TOOL, unresolved: false };
}
