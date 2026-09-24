import { AuditEventCreate, type AuditEventCreate as AuditEventCreateType } from "@/contracts/audit-event";

export function auditEventValues(input: AuditEventCreateType): AuditEventCreateType {
  return AuditEventCreate.parse(input);
}
