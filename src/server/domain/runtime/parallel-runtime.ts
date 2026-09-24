import { WorkflowNode, type ParallelBranch } from "@/contracts/workflow";

const SUPPORTED_INLINE_TYPES = new Set(["ai", "tool", "knowledge", "system"]);

export type PreparedParallelBranch = Omit<ParallelBranch, "steps"> & { steps: WorkflowNode[] };
export type PreparedParallel =
  | { ok: true; branches: PreparedParallelBranch[] }
  | { ok: false; error: string };

export function prepareParallelBranches(node: WorkflowNode): PreparedParallel {
  const parallel = node.parallel;
  if (!parallel || parallel.branches.length < 2) {
    return { ok: false, error: `步骤「${node.title}」至少需要两项并行工作` };
  }
  if (parallel.strategy === "any") {
    return { ok: false, error: `步骤「${node.title}」的“任一完成即继续”暂不支持安全取消其余工作` };
  }
  const ids = new Set<string>();
  const branches: PreparedParallelBranch[] = [];
  for (const branch of parallel.branches) {
    if (ids.has(branch.id)) return { ok: false, error: `步骤「${node.title}」存在重复的并行工作标识` };
    ids.add(branch.id);
    const steps: WorkflowNode[] = [];
    for (const [stepIndex, raw] of branch.steps.entries()) {
      const parsed = WorkflowNode.safeParse({
        ...raw,
        id: `${node.id}.${branch.id}.${String(raw.id || `step_${stepIndex + 1}`)}`,
        title: String(raw.title || `并行步骤 ${stepIndex + 1}`),
        next: null,
        requirementIds: Array.isArray(raw.requirementIds) ? raw.requirementIds : [],
      });
      if (!parsed.success) {
        return { ok: false, error: `并行工作「${branch.label}」的第 ${stepIndex + 1} 个步骤配置不完整` };
      }
      if (!SUPPORTED_INLINE_TYPES.has(parsed.data.type)) {
        return { ok: false, error: `并行工作「${branch.label}」暂不支持步骤类型「${parsed.data.type}」` };
      }
      steps.push(parsed.data);
    }
    branches.push({ ...branch, steps });
  }
  return { ok: true, branches };
}
