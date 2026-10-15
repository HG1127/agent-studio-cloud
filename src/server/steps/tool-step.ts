"use step";
// 工具步骤：演示工具保持确定性回执；真实工具只从服务端注册表取地址和凭据，草稿不保存秘密。
import { FatalError, getStepMetadata, RetryableError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import type { InlineOutputReferences } from "@/contracts/inline-output-reference";
import { validateJsonObjectSchema } from "@/server/domain/json-schema";
import { canRetryStep, MAX_STEP_ATTEMPTS, resolveToolRetryPolicy } from "@/server/domain/runtime/retry-policy";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";
import { invokeRegisteredTool } from "@/server/tools/invoke-tool";
import { getToolRegistration } from "@/server/tools/tool-registry";
import { toolRegistrationCompatibilityIssue } from "@/server/tools/tool-binding";
import { resolveNodeInput } from "@/server/domain/runtime/input-mapping";
import { invokeToolOperation } from "@/server/services/tool-operation";
import { ToolOperationTraceData } from "@/contracts/tool-operation";
import { enforceHarnessPolicy } from "@/server/steps/harness-policy-step";
import { resolveStepToolOperation } from "@/server/domain/runtime/tool-operation";
import { toolStepIdempotencyKey } from "@/server/domain/runtime/tool-step-idempotency-key";

export interface RunToolStepInput {
  runId: string;
  node: WorkflowNode;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
  inlineReferences?: InlineOutputReferences;
}

export async function runToolStep(args: RunToolStepInput): Promise<{ receipt: Record<string, unknown> }> {
  "use step";
  const { node } = args;
  const stepMetadata = getStepMetadata();
  const reject = async (reason: string, retryable = false, retryAfterMs?: number): Promise<never> => {
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
    if (retryable) {
      const policy = resolveToolRetryPolicy(node);
      if (canRetryStep(stepMetadata.attempt, policy.maxAttempts)) {
        throw new RetryableError(reason, { retryAfter: retryAfterMs ?? policy.backoffMs });
      }
    }
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
  await enforceHarnessPolicy({ runId: args.runId, node });
  if (!tool || tool.unresolved === true) {
    return reject(`步骤「${node.title}」的工具未绑定，无法执行`);
  }
  const demo = tool.protocol === "demo";
  const resolvedInput = resolveNodeInput({ node, input: args.input, outputs: args.outputs, inlineReferences: args.inlineReferences });
  if (!resolvedInput.ok) return reject(resolvedInput.error);
  let receipt: Record<string, unknown>;
  if (demo) {
    // 演示延迟：sleep() 只能在 workflow 函数体内调用，步骤内用 Node 定时器模拟
    await new Promise((resolve) => setTimeout(resolve, 300));
    receipt = { ok: true, tool: tool.action, summary: "演示工具已执行" };
  } else {
    const registration = getToolRegistration(tool.registryToolId);
    if (!registration) return reject(`步骤「${node.title}」绑定的业务工具未在服务端配置`);
    const compatibilityIssue = toolRegistrationCompatibilityIssue(tool, registration);
    if (compatibilityIssue) return reject(`步骤「${node.title}」${compatibilityIssue}`);
    const requestPayload = { action: tool.action || registration.action, input: resolvedInput.input, outputs: resolvedInput.outputs };
    const schemaPayload = registration.protocol === "mcp-streamable-http" ? requestPayload.input : requestPayload;
    const inputSchemaError = validateJsonObjectSchema(schemaPayload, tool.inputSchema);
    if (inputSchemaError) return reject(`工具输入不符合字段契约：${inputSchemaError}`);
    const currentInputSchemaError = validateJsonObjectSchema(schemaPayload, registration.inputSchema);
    if (currentInputSchemaError) return reject(`工具输入不符合当前服务端字段契约：${currentInputSchemaError}`);
    const operation = resolveStepToolOperation({ node, runId: args.runId, stepId: stepMetadata.stepId, attempt: stepMetadata.attempt, startedAt: stepMetadata.stepStartedAt });
    if (!operation.ok) return reject(operation.error);
    const operationResult = operation.config ? await invokeToolOperation({
      runId: args.runId, node: { ...node, toolOperation: operation.config }, tool: registration,
      input: args.input, outputs: args.outputs, payload: requestPayload, inlineReferences: args.inlineReferences,
      stepInvocation: operation.stepInvocation,
    }) : undefined;
    const invoked = operationResult ?? await invokeRegisteredTool({
      tool: registration,
      // 同一次步骤重试时 stepId 稳定；循环再次调用同一节点时 stepId 会变化。
      idempotencyKey: toolStepIdempotencyKey({ runId: args.runId, nodeId: node.id, stepId: stepMetadata.stepId }),
      action: requestPayload.action,
      input: requestPayload.input,
      outputs: requestPayload.outputs,
    });
    if (!invoked.ok) return reject(invoked.error, invoked.retryable, operationResult && !operationResult.ok ? operationResult.retryAfterMs : undefined);
    if (operationResult?.ok) {
      await appendTrace({
        runId: args.runId, nodeId: node.id, kind: operationResult.reused ? "tool.operation_reused" : "tool.operation_completed",
        title: operationResult.confirmedByHuman ? `「${node.title}」已复用人工核对后的业务回执`
          : operationResult.reused ? `「${node.title}」已复用相同业务操作的回执` : `「${node.title}」已保存业务操作回执`,
        data: ToolOperationTraceData.parse({ operationId: operationResult.operationId, reused: operationResult.reused, confirmedByHuman: operationResult.confirmedByHuman ?? false }),
      });
    }
    if (Object.hasOwn(invoked.output, "ok") && invoked.output.ok !== true) {
      return reject("业务系统回执表明操作未完成");
    }
    const schemaError = validateJsonObjectSchema(invoked.output, tool.outputSchema);
    if (schemaError) return reject(`业务系统回执不符合字段契约：${schemaError}`);
    const currentSchemaError = validateJsonObjectSchema(invoked.output, registration.outputSchema);
    if (currentSchemaError) return reject(`业务系统回执不符合当前服务端字段契约：${currentSchemaError}`);
    receipt = { ok: true, ...invoked.output };
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
    data: { ok: receipt.ok === true },
  });
  return { receipt };
}

// SDK 的 maxRetries 不含首次调用；节点自己的较小上限由步骤内按 attempt 截断。
runToolStep.maxRetries = MAX_STEP_ATTEMPTS - 1;
