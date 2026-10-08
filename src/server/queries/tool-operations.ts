import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ToolOperationView } from "@/contracts/tool-operation";
import { toolOperations } from "@/db/schema";
import { db } from "@/lib/db";
import { redactCredentialData, redactSensitiveText } from "@/server/domain/security/redact-sensitive";

export async function getToolOperation(workspaceId: string, operationId: string): Promise<ToolOperationView | null> {
  if (!z.string().uuid().safeParse(workspaceId).success || !z.string().uuid().safeParse(operationId).success) return null;
  const [row] = await db.select().from(toolOperations).where(and(
    eq(toolOperations.workspaceId, workspaceId), eq(toolOperations.id, operationId),
  )).limit(1);
  if (!row) return null;
  return ToolOperationView.parse({
    id: row.id, sourceRunId: row.sourceRunId, nodeTitle: row.nodeTitle, toolId: row.toolId, status: row.status,
    error: row.error ? redactSensitiveText(row.error) : null, receipt: row.receipt ? redactCredentialData(row.receipt) : null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    retryDeadline: row.retryDeadline.toISOString(), resolutions: row.resolutions,
  });
}
