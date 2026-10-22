import type { ToolRegistryOption } from "../../src/contracts/tool-registry";
import { ToolSpec, WorkflowDraft } from "../../src/contracts/workflow";

export function workflowToolBindingDesktopDraft(tool: ToolRegistryOption, name: string) {
  const bound = ToolSpec.parse({ connector: tool.name, action: tool.action, scope: tool.scope, risk: tool.risk,
    registryToolId: tool.id, protocol: tool.protocol ?? "http-json", unresolved: false, maxRetries: 7,
    ...(tool.operationKind === undefined ? {} : { operationKind: tool.operationKind }),
    inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, intentAction: "核对原有业务资料" });
  return WorkflowDraft.parse({ id: "tool-binding-desktop", rootAgent: { id: "00000000-0000-4000-8000-0000000000b7", name, role: "核对工具草稿绑定，不运行外部业务" }, startNodeId: "start", nodes: {
    start: { id: "start", title: "开始核对", type: "trigger", next: "decision" },
    decision: { id: "decision", title: "核对业务条件", type: "condition", condition: { source: "input.confirmed", operator: "eq", branches: [{ label: "确认后核对", value: true, next: "business" }], defaultNext: "loop" }, onErrorNext: "end" },
    business: { id: "business", title: "原业务核对步骤", type: "tool", next: "loop", rejectNext: "end", onErrorNext: "end", tool: bound,
      description: "绑定变更后仍需人工核对旧映射与业务防重，不据此认定可以运行", retry: { maxAttempts: 2, backoffMs: 1200 },
      inputMapping: { includeUpstreamOutputs: false, fields: [{ target: ["review"], source: { kind: "literal", value: 0 }, required: true }] },
      toolOperation: { scope: "binding.review", key: { kind: "literal", value: "isolated-desktop-binding-only" } }, businessSpec: { receiptRequired: true, humanReviewRequired: true },
    },
    loop: { id: "loop", title: "逐项核对材料", type: "loop", loop: { collectionPath: "input.items", itemKey: "entry", maxIterations: 3, bodyNext: "body", exitNext: "end" } },
    body: { id: "body", title: "整理本项材料", type: "system", system: { kind: "summary" }, next: "loop" },
    end: { id: "end", title: "核对结束", type: "end" },
  }, variables: [{ name: "confirmed", label: "已确认", type: "boolean", scope: "run", required: false }, { name: "items", label: "材料清单", type: "array", scope: "run", required: false }],
  memoryPolicy: { taskContext: true, longTerm: false }, ui: { positions: { start: { x: 40, y: 20 }, decision: { x: 40, y: 150 }, business: { x: 280, y: 280 }, loop: { x: 40, y: 430 }, body: { x: 280, y: 430 }, end: { x: 40, y: 660 } } } });
}
