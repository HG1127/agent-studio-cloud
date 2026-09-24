import { WorkflowNode, type WorkflowDraft, type WorkflowNodeType } from "@/contracts/workflow";

export const ADDABLE_NODE_TYPES = [
  "ai",
  "human",
  "tool",
  "knowledge",
  "condition",
  "loop",
  "wait",
  "memory",
  "agent_call",
  "handoff",
] as const satisfies readonly WorkflowNodeType[];

const TITLES: Record<(typeof ADDABLE_NODE_TYPES)[number], string> = {
  ai: "新增智能处理",
  human: "新增员工确认",
  tool: "新增业务操作",
  knowledge: "新增资料读取",
  condition: "新增情况判断",
  loop: "新增逐项处理",
  wait: "新增等待步骤",
  memory: "新增经验参考",
  agent_call: "新增助手协作",
  handoff: "新增助手交接",
};

function nextNodeId(draft: WorkflowDraft, type: (typeof ADDABLE_NODE_TYPES)[number]): string {
  let index = 1;
  while (draft.nodes[`${type}_${index}`]) index += 1;
  return `${type}_${index}`;
}

export function createWorkflowNode(draft: WorkflowDraft, type: (typeof ADDABLE_NODE_TYPES)[number]): {
  draft: WorkflowDraft;
  nodeId: string;
} {
  const id = nextNodeId(draft, type);
  const base = { id, title: TITLES[type], type, next: null, requirementIds: [] };
  const specific = type === "human"
    ? { approval: { role: "业务负责人", reason: "确认内容无误后继续" } }
    : type === "tool"
      ? { tool: { connector: "demo", action: "demo", scope: "当前工作区", risk: "low" as const, maxRetries: 1, registryToolId: "demo", protocol: "demo", inputSchema: { type: "object" }, outputSchema: { type: "object" } } }
      : type === "knowledge"
        ? { knowledge: { space: "业务资料库", query: "" } }
        : type === "condition"
          ? { condition: { source: "input.input", operator: "eq", branches: [{ label: "满足", value: "是", next: null }], defaultNext: null } }
          : type === "loop"
            ? { loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 20, bodyNext: null, exitNext: null } }
            : type === "wait"
              ? { wait: { mode: "delay" as const, durationMs: 60_000, until: null, eventKey: "", payloadSchema: { type: "object" }, timeoutMs: 0, onTimeoutNext: null } }
              : type === "memory"
                ? { memory: { mode: "read" as const, query: "", limit: 5 } }
                : type === "agent_call"
                  ? { agentCall: { targetAgentId: "", versionId: "" } }
                  : type === "handoff"
                    ? { toAgent: { id: "", versionId: "" } }
                    : {};
  const node = WorkflowNode.parse({ ...base, ...specific });
  return { draft: { ...draft, nodes: { ...draft.nodes, [id]: node } }, nodeId: id };
}
