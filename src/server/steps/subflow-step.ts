"use step";
import type { WorkflowNode } from "@/contracts/workflow";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export async function beginSubflow(args: { runId: string; node: WorkflowNode; stepCount: number }): Promise<void> {
  "use step";
  await persistStep({
    runId: args.runId,
    nodeId: args.node.id,
    nodeTitle: args.node.title,
    nodeType: args.node.type,
    status: "running",
  });
  await appendTrace({
    runId: args.runId,
    nodeId: args.node.id,
    kind: "subflow.started",
    title: `「${args.node.title}」开始执行 ${args.stepCount} 个子步骤`,
  });
}

export async function finishSubflow(args: {
  runId: string;
  node: WorkflowNode;
  output: Record<string, unknown>;
  failed: boolean;
  handled: boolean;
}): Promise<void> {
  "use step";
  await persistStep({
    runId: args.runId,
    nodeId: args.node.id,
    nodeTitle: args.node.title,
    nodeType: args.node.type,
    status: args.failed && !args.handled ? "failed" : "succeeded",
    output: args.output,
    error: args.failed && !args.handled ? "有子步骤没有完成" : null,
  });
  await appendTrace({
    runId: args.runId,
    nodeId: args.node.id,
    kind: args.failed ? (args.handled ? "subflow.completed_with_issues" : "subflow.failed") : "subflow.completed",
    level: args.failed ? "warn" : "info",
    title: args.failed
      ? args.handled ? `「${args.node.title}」保留问题后继续` : `「${args.node.title}」未能完成`
      : `「${args.node.title}」已完成`,
    data: {
      name: args.output.name,
      status: args.output.status,
      expectedOutputs: args.output.expectedOutputs,
    },
  });
}
