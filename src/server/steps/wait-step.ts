"use step";
import { and, eq, inArray } from "drizzle-orm";
import { FatalError, getStepMetadata } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { runs } from "@/db/schema";
import { db } from "@/lib/db";
import { createWaitEventToken } from "@/server/security/wait-event-token";
import { markRunRunning, persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";
import { withSafeWorkflowError } from "@/server/security/workflow-error";

function waitDescription(node: WorkflowNode): string {
  const wait = node.wait;
  if (!wait) return "等待设置不完整";
  if (wait.mode === "delay") return `等待 ${wait.durationMs} 毫秒后继续`;
  if (wait.mode === "until") return `等待到 ${wait.until ?? "指定时刻"} 后继续`;
  return wait.eventLabel ? `等待消息：${wait.eventLabel}` : `等待消息：${wait.eventKey}`;
}

function workflowStepId(): string {
  try {
    return getStepMetadata().stepId;
  } catch {
    return "direct-call";
  }
}

export async function beginWait(args: { runId: string; node: WorkflowNode; hookToken?: string }): Promise<void> {
  "use step";
  const stepId = workflowStepId();
  if (!args.node.wait) throw new FatalError(`步骤「${args.node.title}」的等待设置不完整`);
  await persistStep({
    runId: args.runId,
    nodeId: args.node.id,
    nodeTitle: args.node.title,
    nodeType: args.node.type,
    status: "running",
  });
  const updated = await withSafeWorkflowError(() => db
    .update(runs)
    .set({ status: "waiting_event", updatedAt: new Date() })
    .where(and(eq(runs.id, args.runId), inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"])))
    .returning({ id: runs.id }), "等待状态暂时无法保存，请稍后重试");
  if (updated.length === 0) throw new FatalError("运行已经结束，不能再进入等待状态");
  const submissionToken = args.node.wait.mode === "event" ? createWaitEventToken() : undefined;
  await appendTrace({
    runId: args.runId,
    nodeId: args.node.id,
    kind: "wait.started",
    title: `「${args.node.title}」正在等待`,
    detail: waitDescription(args.node),
    data: args.node.wait.mode === "event"
      ? {
          eventKey: args.node.wait.eventKey,
          payloadSchema: args.node.wait.payloadSchema,
          hookToken: args.hookToken,
          submissionToken,
        }
      : null,
    dedupeKey: `wait-started:${stepId}`,
  });
}

export async function completeWait(args: {
  runId: string;
  node: WorkflowNode;
  output: Record<string, unknown>;
  timedOut?: boolean;
}): Promise<void> {
  "use step";
  const stepId = workflowStepId();
  await persistStep({
    runId: args.runId,
    nodeId: args.node.id,
    nodeTitle: args.node.title,
    nodeType: args.node.type,
    status: "succeeded",
    output: args.output,
  });
  const resumed = await markRunRunning(args.runId);
  if (!resumed) throw new FatalError("运行已经结束，不能继续等待后的步骤");
  await appendTrace({
    runId: args.runId,
    nodeId: args.node.id,
    kind: args.timedOut ? "wait.timed_out" : "wait.resumed",
    level: args.timedOut ? "warn" : "info",
    title: args.timedOut ? `「${args.node.title}」等待超时` : `「${args.node.title}」已继续`,
    dedupeKey: `wait-completed:${stepId}`,
  });
}
