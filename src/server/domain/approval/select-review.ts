import { boundedJsonStorageValue } from "@/contracts/json";
import { ApprovalReview, MAX_APPROVAL_REVIEW_BYTES } from "@/contracts/run";
import type { WorkflowNode } from "@/contracts/workflow";
import { redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";

const ReviewJson = boundedJsonStorageValue(MAX_APPROVAL_REVIEW_BYTES, "待确认内容");

export function selectApprovalReview(
  outputs: Record<string, unknown>,
  nodes: Record<string, WorkflowNode>,
  preferredSourceNodeId?: string,
): ApprovalReview | null {
  const candidates = Object.entries(outputs).reverse();
  if (preferredSourceNodeId !== undefined) {
    const index = candidates.findIndex(([nodeId]) => nodeId === preferredSourceNodeId);
    const source = nodes[preferredSourceNodeId];
    if (index < 0 || !(source?.type === "ai" || (source?.type === "rule" && source.rule?.kind === "business_rule" && !source.quality))) {
      throw new Error("本次待确认成果来源不完整");
    }
    candidates.unshift(...candidates.splice(index, 1));
  }
  for (const [nodeId, output] of candidates) {
    const node = nodes[nodeId];
    if (node?.type !== "ai" && !(node?.type === "rule" && node.rule?.kind === "business_rule" && !node.quality)) continue;
    if (nodeId === preferredSourceNodeId && (output === null || (typeof output !== "object" && !(typeof output === "string" && output.trim())))) {
      throw new Error("本次模型没有可审核成果");
    }
    if (typeof output === "string" && output.trim()) {
      return ApprovalReview.parse({ sourceNodeId: nodeId, sourceTitle: node.title, content: output });
    }
    if (output === null || typeof output !== "object") continue;
    const value = ReviewJson.parse(output);
    // 先按对象字段隐藏凭据；序列化后秘密会藏在字符串中，不能只依赖文本脱敏。
    const safe = ReviewJson.parse(redactStructuredCredentialData(value));
    const pretty = JSON.stringify(safe, null, 2);
    const content = new TextEncoder().encode(pretty).byteLength <= MAX_APPROVAL_REVIEW_BYTES ? pretty : JSON.stringify(safe);
    return ApprovalReview.parse({ sourceNodeId: nodeId, sourceTitle: node.title, content, format: "json" });
  }
  return null;
}
