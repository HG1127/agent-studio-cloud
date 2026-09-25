"use step";
import type { WorkflowNode } from "@/contracts/workflow";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export async function beginParallel(args: { runId: string; node: WorkflowNode; branchCount: number }): Promise<void> {
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
    kind: "parallel.started",
    title: `「${args.node.title}」已同时启动 ${args.branchCount} 项工作`,
  });
}

export async function finishParallel(args: {
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
    error: args.failed && !args.handled ? "有并行工作没有完成" : null,
  });
  await appendTrace({
    runId: args.runId,
    nodeId: args.node.id,
    kind: args.failed ? (args.handled ? "parallel.completed_with_issues" : "parallel.failed") : "parallel.completed",
    level: args.failed ? "warn" : "info",
    title: args.failed
      ? args.handled ? `「${args.node.title}」保留问题后继续` : `「${args.node.title}」有工作未完成`
      : `「${args.node.title}」全部完成`,
    data: {
      strategy: args.output.strategy,
      status: args.output.status,
      completedCount: args.output.completedCount,
      failedCount: args.output.failedCount,
      selectedBranchId: args.output.selectedBranchId,
    },
  });
}
