import { MAX_SUBFLOW_STEPS, WorkflowNode } from "@/contracts/workflow";

const SUPPORTED_INLINE_TYPES = new Set(["ai", "tool", "knowledge", "system", "memory", "agent_call", "handoff"]);

export type PreparedSubflow = {
  ok: true;
  name: string;
  outputNames: string[];
  failurePolicy: "checkpoint" | "continue";
  steps: WorkflowNode[];
};
export type PrepareSubflowResult = PreparedSubflow | { ok: false; error: string };

export function prepareSubflow(node: WorkflowNode): PrepareSubflowResult {
  const subflow = node.subflow;
  if (!subflow?.name.trim() || subflow.steps.length === 0) {
    return { ok: false, error: `步骤「${node.title}」的一组步骤配置不完整` };
  }
  if (subflow.steps.length > MAX_SUBFLOW_STEPS) {
    return { ok: false, error: `一组步骤「${subflow.name}」最多允许 ${MAX_SUBFLOW_STEPS} 个步骤` };
  }
  const steps: WorkflowNode[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of subflow.steps.entries()) {
    const sourceId = String(raw.id || `step_${index + 1}`);
    if (ids.has(sourceId)) return { ok: false, error: `一组步骤「${subflow.name}」存在重复的步骤标识` };
    ids.add(sourceId);
    const parsed = WorkflowNode.safeParse({
      ...raw,
      id: `${node.id}.${sourceId}`,
      title: String(raw.title || `子步骤 ${index + 1}`),
      type: String(raw.type || "ai"),
      next: null,
      requirementIds: Array.isArray(raw.requirementIds) ? raw.requirementIds : [],
    });
    if (!parsed.success) {
      return { ok: false, error: `一组步骤「${subflow.name}」的第 ${index + 1} 个步骤配置不完整` };
    }
    if (!SUPPORTED_INLINE_TYPES.has(parsed.data.type)) {
      return { ok: false, error: `一组步骤「${subflow.name}」暂不支持步骤类型「${parsed.data.type}」` };
    }
    steps.push(parsed.data);
  }
  return {
    ok: true,
    name: subflow.name,
    outputNames: subflow.outputs,
    failurePolicy: subflow.failurePolicy,
    steps,
  };
}
