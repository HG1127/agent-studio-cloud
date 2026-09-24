"use step";
import { and, eq, inArray } from "drizzle-orm";
import { FatalError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { runs } from "@/db/schema";
import { db } from "@/lib/db";
import { markRunRunning, persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

function waitDescription(node: WorkflowNode): string {
  const wait = node.wait;
  if (!wait) return "等待设置不完整";
  if (wait.mode === "delay") return `等待 ${wait.durationMs} 毫秒后继续`;
  if (wait.mode === "until") return `等待到 ${wait.until ?? "指定时刻"} 后继续`;
  return wait.eventLabel ? `等待消息：${wait.eventLabel}` : `等待消息：${wait.eventKey}`;
}

export async function beginWait(args: { runId: string; node: WorkflowNode }): Promise<void> {
  "use step";
  if (!args.node.wait) throw new FatalError(`步骤「${args.node.title}」的等待设置不完整`);
  await persistStep({
    runId: args.runId,
    nodeId: args.node.id,
    nodeTitle: args.node.title,
    nodeType: args.node.type,
    status: "running",
  });
  const updated = await db
    .update(runs)
    .set({ status: "waiting_event", updatedAt: new Date() })
    .where(and(eq(runs.id, args.runId), inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"])))
    .returning({ id: runs.id });
  if (updated.length === 0) throw new FatalError("运行已经结束，不能再进入等待状态");
  await appendTrace({
    runId: args.runId,
    nodeId: args.node.id,
    kind: "wait.started",
    title: `「${args.node.title}」正在等待`,
    detail: waitDescription(args.node),
    data: args.node.wait.mode === "event"
      ? { eventKey: args.node.wait.eventKey, payloadSchema: args.node.wait.payloadSchema }
      : null,
  });
}

export async function completeWait(args: {
  runId: string;
  node: WorkflowNode;
  output: Record<string, unknown>;
  timedOut?: boolean;
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
  await markRunRunning(args.runId);
  await appendTrace({
    runId: args.runId,
    nodeId: args.node.id,
    kind: args.timedOut ? "wait.timed_out" : "wait.resumed",
    level: args.timedOut ? "warn" : "info",
    title: args.timedOut ? `「${args.node.title}」等待超时` : `「${args.node.title}」已继续`,
  });
}
