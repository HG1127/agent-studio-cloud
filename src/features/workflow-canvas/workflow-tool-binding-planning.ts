import { z } from "zod";
import { isPlainJsonObject } from "@/contracts/json";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { WorkflowDraft } from "@/contracts/workflow";
import { readToolRegistryDefinitions } from "@/features/capabilities/tool-registry-definition";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { insertWorkflowNodeAfter } from "./create-workflow-node";
import { toolBindingChanges } from "./tool-binding-status";
import { selectedRegistryToolSpec } from "./tool-registry-selection";
import { updateWorkflowNode } from "./update-workflow-node";

export const WorkflowToolBindingSelection = z.object({
  toolId: ToolRegistryOption.shape.id,
  mode: z.enum(["existing", "after"]),
  targetNodeId: z.string().min(1),
}).strict();
export type WorkflowToolBindingSelection = z.infer<typeof WorkflowToolBindingSelection>;

export const WorkflowToolBindingChange = z.object({
  toolId: ToolRegistryOption.shape.id,
  toolName: ToolRegistryOption.shape.name,
  nodeId: z.string().min(1),
  nodeTitle: z.string(),
  mode: WorkflowToolBindingSelection.shape.mode,
  changedFields: z.array(z.string()),
  hasInputMapping: z.boolean(),
  hasToolOperation: z.boolean(),
}).strict();
export type WorkflowToolBindingChange = z.infer<typeof WorkflowToolBindingChange>;

function passiveJsonCopy(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || ancestors.has(value)) throw new Error("invalid local context");
  const array = Array.isArray(value);
  if (!array && !isPlainJsonObject(value)) throw new Error("invalid local context");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  ancestors.add(value);
  try {
    if (array) {
      const length = descriptors.length;
      if (!length || !Object.hasOwn(length, "value") || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) throw new Error("invalid local context");
      const copy: unknown[] = [];
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("invalid local context");
        copy.push(passiveJsonCopy(descriptor.value, ancestors));
      }
      return copy;
    }
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") throw new Error("invalid local context");
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("invalid local context");
      copy[key] = passiveJsonCopy(descriptor.value, ancestors);
    }
    return copy;
  } finally { ancestors.delete(value); }
}

function readBindingContext(workflow: WorkflowDraft, tools: readonly ToolRegistryOption[]) {
  const parsed = WorkflowDraft.safeParse(passiveJsonCopy(workflow));
  const registered = readToolRegistryDefinitions(passiveJsonCopy(tools));
  return parsed.success && registered !== null ? { workflow: parsed.data, tools: registered } : null;
}

export function workflowToolBindingContextSnapshot(workflow: WorkflowDraft, tools: readonly ToolRegistryOption[]): string | null {
  try {
    const context = readBindingContext(workflow, tools);
    return context ? JSON.stringify(context) : null;
  } catch { return null; }
}

const failure = (error: string, toolId: string | null = null) => ({ ok: false as const, error, toolId });

export function prepareWorkflowToolBindings(workflow: WorkflowDraft, tools: readonly ToolRegistryOption[], selections: readonly WorkflowToolBindingSelection[]) {
  try {
    const context = readBindingContext(workflow, tools);
    if (!context) return failure("当前流程或工具登记暂时无法核对，请重新读取。");
    const parsed = WorkflowToolBindingSelection.array().safeParse(passiveJsonCopy(selections));
    if (!parsed.success) return failure("工具使用方案不完整，请重新选择工具和步骤。");
    const chosenTools = new Set<string>();
    const occupiedNodes = new Set<string>();
    const insertedAfter = new Map<string, string>();
    const changes: WorkflowToolBindingChange[] = [];
    let draft = context.workflow;
    for (const selection of parsed.data) {
      const tool = context.tools.find((option) => option.id === selection.toolId);
      if (!tool) return failure("所选工具已无法在当前登记中核对，请重新选择。", selection.toolId);
      if (chosenTools.has(tool.id)) return failure("同一个工具只能安排一次，请检查所选方案。", tool.id);
      chosenTools.add(tool.id);
      const target = Object.hasOwn(context.workflow.nodes, selection.targetNodeId) ? context.workflow.nodes[selection.targetNodeId] : undefined;
      if (!target) return failure("找不到所选步骤，请重新选择。", tool.id);
      if (isHiddenControlNode(target)) return failure("内部控制步骤不能作为工具使用位置，请选择业务步骤。", tool.id);
      let nodeId = target.id;
      if (selection.mode === "existing") {
        if (target.type !== "tool") return failure("已有步骤必须是业务工具步骤，请重新选择。", tool.id);
        if (occupiedNodes.has(nodeId)) return failure("同一个已有工具步骤不能重复安排，请调整所选位置。", tool.id);
        occupiedNodes.add(nodeId);
      } else {
        const inserted = insertWorkflowNodeAfter(draft, "tool", insertedAfter.get(target.id) ?? target.id);
        if ("error" in inserted) return failure(inserted.error, tool.id);
        draft = inserted.draft;
        nodeId = inserted.nodeId;
        insertedAfter.set(target.id, nodeId);
      }
      const node = draft.nodes[nodeId];
      const changedFields = node.tool ? toolBindingChanges(node.tool, tool) : [];
      if (node.tool?.registryToolId !== tool.id) changedFields.unshift("工具选择");
      if (node.tool?.connector !== tool.name) changedFields.push("工具名称");
      if (node.tool?.unresolved !== false) changedFields.push("绑定状态");
      const selected = selectedRegistryToolSpec(tool.id, node.tool?.action ?? "", context.tools, node.tool?.maxRetries ?? 3);
      const bound = {
        ...node,
        ...(selection.mode === "after" ? { title: tool.name } : {}),
        tool: { ...selected, ...(node.tool?.intentAction === undefined ? {} : { intentAction: node.tool.intentAction }) },
      };
      draft = selection.mode === "existing" ? updateWorkflowNode(draft, nodeId, bound)
        : { ...draft, nodes: { ...draft.nodes, [nodeId]: bound } };
      changes.push(WorkflowToolBindingChange.parse({ toolId: tool.id, toolName: tool.name, nodeId, nodeTitle: bound.title,
        mode: selection.mode, changedFields, hasInputMapping: node.inputMapping !== undefined, hasToolOperation: node.toolOperation !== undefined }));
    }
    const final = WorkflowDraft.safeParse(draft);
    if (!final.success) return failure("绑定后的流程超出限制或配置不完整，请调整后再试。");
    return { ok: true as const, draft: final.data, changes, changed: JSON.stringify(context.workflow) !== JSON.stringify(final.data) };
  } catch { return failure("当前流程或工具使用方案暂时无法核对，请重新读取。"); }
}
