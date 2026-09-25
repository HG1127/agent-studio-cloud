"use step";
// 条件步骤：消费 condition-eval 纯函数，按分支规则（或默认分支）决定下一节点 id。
import { FatalError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { compare, matchConditionRules, resolvePath, type RunEvalContext } from "@/server/domain/runtime/condition-eval";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export interface EvaluateConditionInput {
  runId: string;
  node: WorkflowNode;
  outputs: Record<string, unknown>;
  input: Record<string, unknown>;
  currentItem?: unknown;
}

export async function evaluateCondition(args: EvaluateConditionInput): Promise<string | null> {
  "use step";
  const { node } = args;
  const reject = async (reason: string): Promise<never> => {
    await persistStep({
      runId: args.runId,
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status: "failed",
      error: reason,
    });
    await appendTrace({
      runId: args.runId,
      nodeId: node.id,
      kind: "step.failed",
      level: "error",
      title: `「${node.title}」无法执行`,
      detail: reason,
    });
    throw new FatalError(reason);
  };
  await appendTrace({
    runId: args.runId,
    nodeId: node.id,
    kind: "step.started",
    title: `开始「${node.title}」`,
    detail: node.description ?? null,
  });
  await persistStep({
    runId: args.runId,
    nodeId: node.id,
    nodeTitle: node.title,
    nodeType: node.type,
    status: "running",
  });
  const condition = node.condition;
  if (!condition) {
    return reject(`步骤「${node.title}」缺少条件配置，无法继续`);
  }
  const ctx: RunEvalContext = { input: args.input, variables: {}, context: { outputs: args.outputs, currentItem: args.currentItem } };
  const actual = resolvePath(condition.source ?? "", ctx);
  let nextId = condition.defaultNext ?? null;
  let matchedLabel: string | null = null;
  for (const branch of condition.branches) {
    const rules = branch.rules ?? [];
    const hit =
      rules.length > 0
        ? matchConditionRules(rules, branch.mode, ctx)
        : compare(actual, condition.operator, branch.value);
    if (hit) {
      nextId = branch.next;
      matchedLabel = branch.label;
      break;
    }
  }
  await persistStep({
    runId: args.runId,
    nodeId: node.id,
    nodeTitle: node.title,
    nodeType: node.type,
    status: "succeeded",
    output: { matched: matchedLabel ?? "默认分支", next: nextId },
  });
  await appendTrace({
    runId: args.runId,
    nodeId: node.id,
    kind: "condition.decided",
    title: matchedLabel ? `条件命中分支「${matchedLabel}」` : "条件未命中，走默认分支",
    data: { source: condition.source ?? null, next: nextId },
  });
  return nextId;
}
