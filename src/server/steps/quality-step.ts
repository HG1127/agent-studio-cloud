"use step";
// 质量门禁步骤：verify_*（rule.kind=tool_result）核对来源工具回执；
// quality_review 按 quality 配置核对产出完整性 / 工具回执 / 人工确认（查 approvals 表）。
import { and, eq, inArray } from "drizzle-orm";
import { FatalError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { db } from "@/lib/db";
import { approvals } from "@/db/schema";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";
import { selectQualityRepair, type QualityRepairPlan } from "@/server/domain/runtime/quality-repair";
import {
  countMeaningfulQualityOutputs,
  hasExecutedHumanStep,
  missingExecutedToolReceipts,
  qualityOutputReferenceIssue,
} from "@/server/domain/runtime/quality-checks";
import { hasMeaningfulResult } from "@/server/domain/runtime/result-content";

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
  repairAttempts: Record<string, number>;
}

export interface QualityGateResult {
  next: string | null;
  repair: (QualityRepairPlan & { feedback: string }) | null;
  output: { passed: true; rejectedStop?: true } | null;
}

export async function runQualityGate(args: RunQualityGateInput): Promise<QualityGateResult> {
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
  if (["tool_result", "tool_receipt"].includes(node.rule?.kind ?? "")) {
    const sourceNodeId = node.rule?.sourceNodeId;
    const receipt = sourceNodeId ? args.outputs[sourceNodeId] : undefined;
    if (!isReceiptOk(receipt)) {
      return reject(`步骤「${node.title}」未取得来源步骤的系统回执，流程停止`);
    }
  } else if (node.quality) {
    const quality = node.quality;
    const referenceIssue = qualityOutputReferenceIssue(args.nodes, quality.requiredOutputTitles);
    if (referenceIssue) return reject(referenceIssue);
    // 拒绝收尾：run 已有 rejected 决定即走 not_approved 语义（保留当前结果并停止高影响动作），
    // 被拒绝分支的交付物/回执按设计不会产生，完整核对不适用，只要求人工决定记录存在
    const [rejectedStop] = await db
      .select({ id: approvals.id })
      .from(approvals)
      .where(and(eq(approvals.runId, args.runId), eq(approvals.status, "rejected")))
      .limit(1);
    if (rejectedStop) {
      await persistStep({
        runId: args.runId,
        nodeId: node.id,
        nodeTitle: node.title,
        nodeType: node.type,
        status: "succeeded",
        output: { passed: true, rejectedStop: true },
      });
      await appendTrace({
        runId: args.runId,
        nodeId: node.id,
        kind: "quality.passed",
        title: `「${node.title}」检查通过（未获确认，保留当前结果并停止高影响动作）`,
      });
      return { next: node.next, repair: null, output: { passed: true, rejectedStop: true } };
    }
    const missingOutputs = quality.requiredOutputTitles.filter((title) => {
      const sourceNode = Object.values(args.nodes).find((item) => item.title === title);
      return !sourceNode || !hasMeaningfulResult(args.outputs[sourceNode.id]);
    });
    if (missingOutputs.length > 0) {
      const reason = `交付前检查未通过：以下步骤还没有形成结果：${missingOutputs.join("、")}`;
      const missingNodes = missingOutputs.flatMap((title) => {
        const source = Object.values(args.nodes).find((item) => item.title === title);
        return source ? [source] : [];
      });
      const repair = selectQualityRepair(missingNodes, args.repairAttempts);
      if (!repair) return reject(reason);
      await appendTrace({
        runId: args.runId,
        nodeId: node.id,
        kind: "quality.rework_requested",
        level: "warn",
        title: `「${node.title}」要求自动返工`,
        detail: `${reason}；正在进行第 ${repair.nextRepairAttempt} 次返工`,
        data: { repairNodeId: repair.nodeId, repairAttempt: repair.nextRepairAttempt, maxAttempts: repair.maxAttempts },
      });
      return { next: node.id, repair: { ...repair, feedback: reason }, output: null };
    }
    const outputCount = countMeaningfulQualityOutputs(args.nodes, args.outputs, quality.requiredOutputTitles);
    if (outputCount < quality.minOutputCount) {
      return reject(`交付前检查未通过：至少需要形成 ${quality.minOutputCount} 项有效结果，当前只有 ${outputCount} 项`);
    }
    if (quality.checkToolReceipts) {
      const missingReceipts = missingExecutedToolReceipts(args.nodes, args.outputs);
      if (missingReceipts.length > 0) {
        return reject(`交付前检查未通过：以下工具步骤缺少系统回执：${missingReceipts.join("、")}`);
      }
    }
    if (quality.checkHumanBoundary && hasExecutedHumanStep(args.nodes, args.outputs)) {
      // approved 与 rejected 都算人工责任已履行：拒绝路径经 not_approved 仍要到质量门禁，若只认 approved 会永远 failRun
      const [decided] = await db
        .select({ id: approvals.id })
        .from(approvals)
        .where(and(eq(approvals.runId, args.runId), inArray(approvals.status, ["approved", "rejected"])))
        .limit(1);
      if (!decided) {
        return reject("交付前检查未通过：需要人工确认的步骤还没有确认记录");
      }
    }
  } else return reject(`步骤「${node.title}」的检查设置不完整`);
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
  return { next: node.next, repair: null, output: { passed: true } };
}
