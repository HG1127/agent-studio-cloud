"use step";
// 知识库步骤（T11 携带裁定 A 补齐）：镜像演示工具步骤；M1 只有演示知识来源。
// space 为空抛 FatalError（知识来源未绑定）；演示读取模拟 300ms 延迟后返回回执。
import { FatalError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export interface RunKnowledgeStepInput {
  runId: string;
  node: WorkflowNode;
}

export async function runKnowledgeStep(args: RunKnowledgeStepInput): Promise<{ receipt: Record<string, unknown> }> {
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
  const space = node.knowledge?.space?.trim() ?? "";
  if (!space) {
    return reject(`步骤「${node.title}」知识来源未绑定`);
  }
  // 演示延迟：sleep() 只能在 workflow 函数体内调用，步骤内用 Node 定时器模拟
  await new Promise((resolve) => setTimeout(resolve, 300));
  const receipt = { ok: true, space, summary: "演示知识库读取完成" };
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
    kind: "knowledge.receipt",
    title: `「${node.title}」已完成演示知识库读取`,
    data: receipt,
  });
  return { receipt };
}
