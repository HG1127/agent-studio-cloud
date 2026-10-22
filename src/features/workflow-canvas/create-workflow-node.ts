import { MAX_WORKFLOW_NODES, WorkflowNode, type WorkflowDraft, type WorkflowNodeType } from "@/contracts/workflow";

export const ADDABLE_NODE_TYPES = [
  "ai",
  "human",
  "tool",
  "knowledge",
  "rule",
  "system",
  "condition",
  "parallel",
  "subflow",
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
  rule: "新增规则检查",
  system: "新增运行记录",
  condition: "新增情况判断",
  parallel: "新增同时处理",
  subflow: "新增一组步骤",
  loop: "新增逐项处理",
  wait: "新增等待步骤",
  memory: "新增经验参考",
  agent_call: "新增助手协作",
  handoff: "新增助手交接",
};

export function canAddWorkflowNode(draft: { nodes: Record<string, unknown> }): boolean {
  return Object.keys(draft.nodes).length < MAX_WORKFLOW_NODES;
}

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
      ? { tool: { connector: "unbound", action: "", scope: "", risk: "high" as const, maxRetries: 3, registryToolId: null, protocol: "unbound", unresolved: true, inputSchema: { type: "object" }, outputSchema: { type: "object" } } }
      : type === "knowledge"
        ? { knowledge: { space: "业务资料库", query: "" } }
        : type === "rule"
          ? { rule: { kind: "business_rule" } }
          : type === "system"
            ? { system: { kind: "summary" } }
        : type === "condition"
          ? { condition: { source: "input.input", operator: "eq", branches: [{ label: "满足", value: "是", next: null }], defaultNext: null } }
          : type === "parallel"
            ? { parallel: {
                strategy: "all" as const,
                failurePolicy: "fail_fast" as const,
                branches: [
                  { id: "branch_1", label: "工作一", inputs: [], outputs: [], steps: [{ id: "step_1", title: "处理工作一", type: "ai", description: "完成这项工作并返回结果" }] },
                  { id: "branch_2", label: "工作二", inputs: [], outputs: [], steps: [{ id: "step_1", title: "处理工作二", type: "ai", description: "完成这项工作并返回结果" }] },
                ],
              } }
            : type === "subflow"
              ? { subflow: {
                  name: "一组顺序步骤",
                  steps: [{ id: "step_1", title: "处理第一步", type: "ai", description: "完成这一步并返回结果" }],
                  inputs: [],
                  outputs: [],
                  failurePolicy: "checkpoint",
                } }
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

export function insertWorkflowNodeAfter(
  draft: WorkflowDraft,
  type: (typeof ADDABLE_NODE_TYPES)[number],
  parentId: string,
): { draft: WorkflowDraft; nodeId: string } | { error: string } {
  const parent = draft.nodes[parentId];
  if (!parent) return { error: "找不到插入位置，请重新选择步骤" };
  if (parent.type === "end") return { error: "完成步骤之后不能再插入步骤" };
  if (!canAddWorkflowNode(draft)) return { error: `流程步骤不能超过 ${MAX_WORKFLOW_NODES} 个` };
  if (parent.type === "condition" && !parent.condition) return { error: "请先配置判断步骤的后续路径" };
  if (parent.type === "loop" && !parent.loop) return { error: "请先配置逐项处理的完成路径" };

  const created = createWorkflowNode(draft, type);
  const continuation = parent.type === "condition"
    ? parent.condition!.defaultNext
    : parent.type === "loop" ? parent.loop!.exitNext : parent.next;
  const inserted = created.draft.nodes[created.nodeId];
  const connected = inserted.type === "condition" && inserted.condition
    ? { ...inserted, next: null, condition: { ...inserted.condition, defaultNext: continuation } }
    : inserted.type === "loop" && inserted.loop
      ? { ...inserted, next: null, loop: { ...inserted.loop, exitNext: continuation } }
      : { ...inserted, next: continuation };
  const updatedParent = parent.type === "condition" && parent.condition
    ? { ...parent, condition: { ...parent.condition, defaultNext: created.nodeId } }
    : parent.type === "loop" && parent.loop
      ? { ...parent, loop: { ...parent.loop, exitNext: created.nodeId } }
      : { ...parent, next: created.nodeId };
  return {
    draft: { ...created.draft, nodes: { ...created.draft.nodes, [parentId]: updatedParent, [created.nodeId]: connected } },
    nodeId: created.nodeId,
  };
}
