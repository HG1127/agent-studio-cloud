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

function cropText(value: string, maxLength: number) {
  let end = Math.min(value.length, maxLength);
  const last = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  return value.slice(0, end);
}

function redactSummaryText(value: string, personal = false) {
  // 摘要可能已在数据库截断，不能依赖凭据的结束标记。
  return (personal ? redactSensitiveText(value) : redactCredentialText(value))
    .replace(/-----BEGIN [^-\r\n]{0,40}PRIVATE KEY-----[\s\S]*$/g, "[已隐藏敏感信息]")
    .replace(/\b(?:api[_-]?key|(?:access[_-]?|refresh[_-]?)?token|secret|password|passcode|authorization)\s*[:=]\s*(?!\[已隐藏敏感信息\])["']?(?:Bearer\s+)?[^\s,"'}）】》」』>]+["']?/gi, "[已隐藏敏感信息]")
    .replace(/(?:(?:访问|刷新)?令牌|密钥|密码|凭据|授权)\s*[：:=]\s*(?!\[已隐藏敏感信息\])["']?(?:Bearer\s+)?[^\s，,。；;）】》」』>]+["']?/gi, "[已隐藏敏感信息]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/]*:[^@\s/]+$/gi, "$1[已隐藏敏感信息]");
}

export function presentAttentionItem(input: AttentionMetadata): AttentionItem {
  const row = AttentionMetadata.parse(input);
  const title = redactSummaryText(row.title);
  const agentName = row.agentName === null ? null : redactSummaryText(row.agentName);
  const error = row.error === null ? null : redactSummaryText(row.error, true);
  return AttentionItem.parse({
    ...row, title: cropText(title, 500), titleTruncated: row.titleTruncated || title.length > 500,
    agentName: agentName === null ? null : cropText(agentName, 200), agentNameTruncated: row.agentNameTruncated || (agentName?.length ?? 0) > 200,
    error: error === null ? null : cropText(error, 2000), errorTruncated: row.errorTruncated || (error?.length ?? 0) > 2000,
    summary: summaries[row.kind], links: attentionLinks(row.kind, row.id, row.runId),
  });
}
