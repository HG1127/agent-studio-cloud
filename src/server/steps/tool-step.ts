"use step";
// 工具步骤：M1 仅支持演示工具（T10a 绑定语义：registryToolId 或 protocol 为 "demo"）。
// 未绑定 / 非演示来源抛 FatalError；演示工具模拟 300ms 延迟后返回回执（UI 已标注演示）。
import { FatalError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export interface RunToolStepInput {
  runId: string;
  node: WorkflowNode;
}

export async function runToolStep(args: RunToolStepInput): Promise<{ receipt: Record<string, unknown> }> {
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
  const tool = node.tool;
  if (!tool || tool.unresolved === true) {
    return reject(`步骤「${node.title}」的工具未绑定，无法执行`);
  }
  if (tool.registryToolId !== "demo" && tool.protocol !== "demo") {
    return reject(`步骤「${node.title}」使用了暂不支持的工具来源，无法执行`);
  }
  // 演示延迟：sleep() 只能在 workflow 函数体内调用，步骤内用 Node 定时器模拟
  await new Promise((resolve) => setTimeout(resolve, 300));
  const receipt = { ok: true, tool: tool.action, summary: "演示工具已执行" };
  await persistStep({
    runId: args.runId,
    nodeId: node.id,
    nodeTitle: node.title,
    nodeType: node.type,
    status: "succeeded",
    output: receipt,
  });
  await appendTrace({
    runId: args.runId,
    nodeId: node.id,
    kind: "tool.receipt",
    title: `「${node.title}」已取得演示回执`,
    data: receipt,
  });
  return { receipt };
}
