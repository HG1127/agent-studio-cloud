import { AuditEventCreate, type AuditEventCreate as AuditEventCreateType } from "@/contracts/audit-event";
import { redactCredentialData, redactCredentialText } from "@/server/domain/security/redact-sensitive";

const MAX_AUDIT_SUMMARY_LENGTH = 200;

function boundedSummary(value: string): string {
  if (value.length <= MAX_AUDIT_SUMMARY_LENGTH) return value;
  let end = MAX_AUDIT_SUMMARY_LENGTH - 1;
  const lastCodeUnit = value.charCodeAt(end - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}…`;
}

export function auditEventValues(input: AuditEventCreateType): AuditEventCreateType {
  return AuditEventCreate.parse({
    ...input,
    summary: boundedSummary(redactCredentialText(input.summary)),
    data: redactCredentialData(input.data),
  });
}
