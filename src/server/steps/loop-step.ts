"use step";
import type { WorkflowNode } from "@/contracts/workflow";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export async function beginLoopIteration(args: {
  runId: string;
  node: WorkflowNode;
  iteration: number;
  total: number;
}): Promise<void> {
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
    kind: "loop.iteration_started",
    title: `「${args.node.title}」正在处理第 ${args.iteration}/${args.total} 项`,
    data: { iteration: args.iteration, total: args.total },
  });
}

export async function completeLoop(args: {
  runId: string;
  node: WorkflowNode;
  output: Record<string, unknown>;
}): Promise<void> {
  "use step";
  await persistStep({
    runId: args.runId,
    nodeId: args.node.id,
    nodeTitle: args.node.title,
    nodeType: args.node.type,
    status: "succeeded",
    output: args.output,
  });
  await appendTrace({
    runId: args.runId,
    nodeId: args.node.id,
    kind: "loop.completed",
    title: `「${args.node.title}」逐项处理完成`,
    detail: args.output.limited
      ? `来源共有 ${String(args.output.sourceCount ?? 0)} 项，按安全上限处理了 ${String(args.output.processedCount ?? 0)} 项`
      : `共处理 ${String(args.output.processedCount ?? 0)} 项`,
    data: {
      processedCount: args.output.processedCount,
      sourceCount: args.output.sourceCount,
      limited: args.output.limited,
    },
  });
}
