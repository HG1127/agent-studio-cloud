import { AttentionItem, AttentionMetadata, attentionLinks, type AttentionKind } from "@/contracts/attention";
import { redactCredentialText, redactSensitiveText } from "@/server/domain/security/redact-sensitive";

const summaries: Record<AttentionKind, string> = {
  "approval-pending": "请读取完整成果后明确确认或退回",
  "approval-resume": "决定已保存，请核对原决定后继续恢复",
  "wait-event": "请打开任务，核对所需消息后提交",
  "run-failed": "请查看失败原因，核对业务副作用后再决定是否重新运行",
  "tool-operation": "请先核对业务系统是否已经执行，不要直接重复写入",
  "delivery-failed": "请查看投递记录，核对接收结果与有效期后再决定是否补投",
};

export function presentAttentionItem(input: AttentionMetadata): AttentionItem {
  const row = AttentionMetadata.parse(input);
  const title = redactCredentialText(row.title);
  const agentName = row.agentName === null ? null : redactCredentialText(row.agentName);
  const error = row.error === null ? null : redactSensitiveText(row.error);
  return AttentionItem.parse({
    ...row, title: title.slice(0, 500), titleTruncated: row.titleTruncated || title.length > 500,
    agentName: agentName?.slice(0, 200) ?? null, agentNameTruncated: row.agentNameTruncated || (agentName?.length ?? 0) > 200,
    error: error?.slice(0, 2000) ?? null, errorTruncated: row.errorTruncated || (error?.length ?? 0) > 2000,
    summary: summaries[row.kind], links: attentionLinks(row.kind, row.id, row.runId),
  });
}
