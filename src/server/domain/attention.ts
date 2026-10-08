import { AttentionItem, AttentionMetadata, attentionLinks, type AttentionKind } from "@/contracts/attention";
import { redactCredentialText, redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { assessAttentionTiming } from "@/server/domain/attention-timing";

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

export function redactAttentionText(value: string, personal = false) {
  // 摘要可能已在数据库截断，不能依赖凭据的结束标记。
  return (personal ? redactSensitiveText(value) : redactCredentialText(value))
    .replace(/-----BEGIN [^-\r\n]{0,40}PRIVATE KEY-----[\s\S]*$/g, "[已隐藏敏感信息]")
    .replace(/\b(?:api[_-]?key|(?:access[_-]?|refresh[_-]?)?token|secret|password|passcode|authorization)\s*[:=]\s*(?!\[已隐藏敏感信息\])["']?(?:Bearer\s+)?[^\s,"'}）】》」』>]+["']?/gi, "[已隐藏敏感信息]")
    .replace(/(?:(?:访问|刷新)?令牌|密钥|密码|凭据|授权)\s*[：:=]\s*(?!\[已隐藏敏感信息\])["']?(?:Bearer\s+)?[^\s，,。；;）】》」』>]+["']?/gi, "[已隐藏敏感信息]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/]*:[^@\s/]+$/gi, "$1[已隐藏敏感信息]");
}

export function presentAttentionItem(input: AttentionMetadata, now?: Date): AttentionItem {
  const { timingSource, ...row } = AttentionMetadata.parse(input);
  if (timingSource && !now) throw new Error("展示等待分类须提供检查时间");
  const timing = timingSource && now ? assessAttentionTiming(timingSource, now) : undefined;
  const title = redactAttentionText(row.kind === "wait-event"
    ? timing?.waitMode === "timer" ? "定时等待" : timing?.waitMode === "event" ? "等待外部消息" : "等待方式待核对"
    : row.title);
  const agentName = row.agentName === null ? null : redactAttentionText(row.agentName);
  const error = row.error === null ? null : redactAttentionText(row.error, true);
  return AttentionItem.parse({
    ...row, title: cropText(title, 500), titleTruncated: row.titleTruncated || title.length > 500,
    agentName: agentName === null ? null : cropText(agentName, 200), agentNameTruncated: row.agentNameTruncated || (agentName?.length ?? 0) > 200,
    error: error === null ? null : cropText(error, 2000), errorTruncated: row.errorTruncated || (error?.length ?? 0) > 2000,
    summary: row.kind === "wait-event" && timing?.waitMode === "timer" ? "这是定时等待，无需提交外部消息；预计时间已过时请检查执行状态"
      : row.kind === "wait-event" && timing?.waitMode !== "event" ? "请打开任务核对等待方式，不要在未确认时提交消息" : summaries[row.kind],
    links: attentionLinks(row.kind, row.id, row.runId), ...(timing ? { timing } : {}),
  });
}
