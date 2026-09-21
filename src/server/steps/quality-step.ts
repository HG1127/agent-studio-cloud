"use step";
// 质量门禁步骤：verify_*（rule.kind=tool_result）核对来源工具回执；
// quality_review 按 quality 配置核对产出完整性 / 工具回执 / 人工确认（查 approvals 表）。
// M1 简化：任一检查不通过 → failRun + FatalError（重写返工记 M2 债务）。
import { and, eq } from "drizzle-orm";
import { FatalError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { db } from "@/lib/db";
import { approvals } from "@/db/schema";
import { failRun, persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

function hasContent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function isReceiptOk(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).ok === true
  );
}

export interface RunQualityGateInput {
  runId: string;
  node: WorkflowNode;
  outputs: Record<string, unknown>;
  nodes: Record<string, WorkflowNode>;
}

export async function runQualityGate(args: RunQualityGateInput): Promise<string | null> {
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
      kind: "quality.failed",
      level: "error",
      title: `「${node.title}」未通过`,
      detail: reason,
    });
    await failRun(args.runId, reason);
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
  if (node.rule?.kind === "tool_result") {
    const sourceNodeId = node.rule.sourceNodeId;
    const receipt = sourceNodeId ? args.outputs[sourceNodeId] : undefined;
    if (!isReceiptOk(receipt)) {
      return reject(`步骤「${node.title}」未取得来源步骤的系统回执，流程停止`);
    }
  } else if (node.quality) {
    const quality = node.quality;
    const missingOutputs = quality.requiredOutputTitles.filter((title) => {
      const sourceNode = Object.values(args.nodes).find((item) => item.title === title);
      return !sourceNode || !hasContent(args.outputs[sourceNode.id]);
    });
    if (missingOutputs.length > 0) {
      return reject(`交付前检查未通过：以下步骤还没有形成结果：${missingOutputs.join("、")}`);
    }
    if (quality.checkToolReceipts) {
      const missingReceipts = Object.values(args.nodes)
        .filter((item) => item.type === "tool" && !isReceiptOk(args.outputs[item.id]))
        .map((item) => item.title);
      if (missingReceipts.length > 0) {
        return reject(`交付前检查未通过：以下工具步骤缺少系统回执：${missingReceipts.join("、")}`);
      }
    }
    if (quality.checkHumanBoundary) {
      const [approved] = await db
        .select({ id: approvals.id })
        .from(approvals)
        .where(and(eq(approvals.runId, args.runId), eq(approvals.status, "approved")))
        .limit(1);
      if (!approved) {
        return reject("交付前检查未通过：需要人工确认的步骤还没有确认记录");
      }
    }
  }
  await persistStep({
    runId: args.runId,
    nodeId: node.id,
    nodeTitle: node.title,
    nodeType: node.type,
    status: "succeeded",
    output: { passed: true },
  });
  await appendTrace({
    runId: args.runId,
    nodeId: node.id,
    kind: "quality.passed",
    title: `「${node.title}」检查通过`,
  });
  return node.next;
}
