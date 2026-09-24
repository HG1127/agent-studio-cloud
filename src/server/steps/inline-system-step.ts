"use step";
import type { WorkflowNode } from "@/contracts/workflow";
import { persistStep } from "@/server/steps/run-state";

export async function runInlineSystemStep(args: { runId: string; node: WorkflowNode }): Promise<{ output: Record<string, unknown> }> {
  "use step";
  const output = { summary: args.node.description || `${args.node.title}已完成` };
  await persistStep({
    runId: args.runId,
    nodeId: args.node.id,
    nodeTitle: args.node.title,
    nodeType: args.node.type,
    status: "running",
  });
  await persistStep({
    runId: args.runId,
    nodeId: args.node.id,
    nodeTitle: args.node.title,
    nodeType: args.node.type,
    status: "succeeded",
    output,
  });
  return { output };
}
