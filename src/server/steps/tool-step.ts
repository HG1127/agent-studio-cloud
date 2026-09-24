"use step";
// 工具步骤：演示工具保持确定性回执；真实工具只从服务端注册表取地址和凭据，草稿不保存秘密。
import { FatalError, RetryableError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { validateJsonObjectSchema } from "@/server/domain/json-schema";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";
import { invokeHttpTool } from "@/server/tools/invoke-http-tool";
import { getToolRegistration } from "@/server/tools/tool-registry";

export interface RunToolStepInput {
  runId: string;
  node: WorkflowNode;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

export async function runToolStep(args: RunToolStepInput): Promise<{ receipt: Record<string, unknown> }> {
  "use step";
  const { node } = args;
  const reject = async (reason: string, retryable = false): Promise<never> => {
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
    if (retryable) throw new RetryableError(reason, { retryAfter: "5s" });
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
  const demo = tool.registryToolId === "demo" || tool.protocol === "demo";
  let receipt: Record<string, unknown>;
  if (demo) {
    // 演示延迟：sleep() 只能在 workflow 函数体内调用，步骤内用 Node 定时器模拟
    await new Promise((resolve) => setTimeout(resolve, 300));
    receipt = { ok: true, tool: tool.action, summary: "演示工具已执行" };
  } else {
    const registration = getToolRegistration(tool.registryToolId);
    if (!registration) return reject(`步骤「${node.title}」绑定的业务工具未在服务端配置`);
    const invoked = await invokeHttpTool({
      tool: registration,
      idempotencyKey: `${args.runId}:${node.id}`,
      action: tool.action || registration.action,
      input: args.input,
      outputs: args.outputs,
    });
    if (!invoked.ok) return reject(invoked.error, invoked.retryable);
    const schemaError = validateJsonObjectSchema(invoked.output, tool.outputSchema);
    if (schemaError) return reject(`业务系统回执不符合字段契约：${schemaError}`);
    receipt = invoked.output;
  }
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
    title: `「${node.title}」已取得${demo ? "演示" : "业务"}回执`,
    data: receipt,
  });
  return { receipt };
}
