import type { WorkflowNode } from "@/contracts/workflow";

type InlineStep = NonNullable<WorkflowNode["subflow"]>["steps"][number];

export function inlineStepId(step: InlineStep, index: number): string {
  return String(step.id || `step_${index + 1}`);
}

export function inlineSequenceIssue(steps: InlineStep[]): string | null {
  if (steps.some((step) => (step.next !== undefined && step.next !== null)
    || step.condition || step.loop || step.rejectNext || step.onErrorNext)) {
    return "原定义含有组内自定义路径。当前执行器按列表顺序处理，不执行这些路径；原配置已保留，暂不能换序、增删步骤，请先核对定义。";
  }
  const ids = steps.map(inlineStepId);
  if (new Set(ids).size !== ids.length) return "原定义含有重复的步骤标识，暂不能换序、增删步骤，请先核对定义。";
  return null;
}

export function stabilizeInlineSteps(steps: InlineStep[]): InlineStep[] {
  // 运行时以位置补缺失标识；修改顺序前固定旧标识，避免改变结果引用。
  return steps.map((step, index) => step.id ? step : { ...step, id: inlineStepId(step, index) });
}

export function moveInlineStep(steps: InlineStep[], index: number, direction: -1 | 1): InlineStep[] {
  const destination = index + direction;
  if (inlineSequenceIssue(steps) || !Number.isInteger(index) || index < 0 || index >= steps.length
    || destination < 0 || destination >= steps.length) return steps;
  const next = stabilizeInlineSteps(steps);
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

export function removeInlineStep(steps: InlineStep[], index: number): InlineStep[] {
  if (inlineSequenceIssue(steps) || steps.length <= 1 || !Number.isInteger(index) || index < 0 || index >= steps.length) return steps;
  return stabilizeInlineSteps(steps).filter((_, stepIndex) => stepIndex !== index);
}

export function precedingInlineSources(steps: InlineStep[], index: number, runtimePrefix: string) {
  const ids = steps.map(inlineStepId);
  return steps.slice(0, index).flatMap((step, stepIndex) => {
    const id = ids[stepIndex];
    if (ids.filter((value) => value === id).length !== 1) return [];
    return [{ id: `${runtimePrefix}.${id}`, title: `本组前序步骤：${String(step.title || `第 ${stepIndex + 1} 步`)}` }];
  });
}
