import { MAX_PARALLEL_BRANCHES, MAX_PARALLEL_STEPS, WorkflowNode, type ParallelBranch } from "@/contracts/workflow";

const SUPPORTED_INLINE_TYPES = new Set(["ai", "tool", "knowledge", "system", "memory", "agent_call", "handoff"]);

export type PreparedParallelBranch = Omit<ParallelBranch, "steps"> & { steps: WorkflowNode[] };
export type PreparedParallel =
  | { ok: true; branches: PreparedParallelBranch[] }
  | { ok: false; error: string };

export function resolveParallelOutcome(args: {
  strategy: "all" | "any" | "all_settled";
  failurePolicy: "fail_fast" | "continue";
  statuses: Array<"completed" | "failed">;
}): { status: "completed" | "completed_with_issues" | "failed"; shouldFail: boolean; selectedIndex: number | null } {
  const completed = args.statuses.filter((status) => status === "completed").length;
  const failed = args.statuses.length - completed;
  if (args.strategy === "any") {
    const selectedIndex = args.statuses.findIndex((status) => status === "completed");
    return selectedIndex >= 0
      ? { status: "completed", shouldFail: false, selectedIndex }
      : { status: "failed", shouldFail: true, selectedIndex: null };
  }
  if (failed === 0) return { status: "completed", shouldFail: false, selectedIndex: null };
  if (args.failurePolicy === "fail_fast") return { status: "failed", shouldFail: true, selectedIndex: null };
  return { status: "completed_with_issues", shouldFail: false, selectedIndex: null };
}

export function prepareParallelBranches(node: WorkflowNode): PreparedParallel {
  const parallel = node.parallel;
  if (!parallel || parallel.branches.length < 2) {
    return { ok: false, error: `步骤「${node.title}」至少需要两项并行工作` };
  }
  if (parallel.branches.length > MAX_PARALLEL_BRANCHES) {
    return { ok: false, error: `步骤「${node.title}」最多允许 ${MAX_PARALLEL_BRANCHES} 项并行工作` };
  }
  const ids = new Set<string>();
  const branches: PreparedParallelBranch[] = [];
  for (const branch of parallel.branches) {
    if (ids.has(branch.id)) return { ok: false, error: `步骤「${node.title}」存在重复的并行工作标识` };
    ids.add(branch.id);
    if (branch.steps.length > MAX_PARALLEL_STEPS) {
      return { ok: false, error: `并行工作「${branch.label}」最多允许 ${MAX_PARALLEL_STEPS} 个步骤` };
    }
    const steps: WorkflowNode[] = [];
    const stepIds = new Set<string>();
    for (const [stepIndex, raw] of branch.steps.entries()) {
      const sourceId = String(raw.id || `step_${stepIndex + 1}`);
      if (stepIds.has(sourceId)) return { ok: false, error: `并行工作「${branch.label}」存在重复的步骤标识` };
      stepIds.add(sourceId);
      const parsed = WorkflowNode.safeParse({
        ...raw,
        id: `${node.id}.${branch.id}.${sourceId}`,
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
