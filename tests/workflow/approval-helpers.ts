import { and, desc, eq } from "drizzle-orm";
import { waitForHook } from "@workflow/vitest";
import { approvals } from "@/db/schema";
import { db } from "@/lib/db";

export async function waitForPendingApprovalHook(
  handle: Parameters<typeof waitForHook>[0],
  runId: string,
  nodeId = "confirm",
  excludeToken?: string,
  timeout = 90_000,
): Promise<string> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({ id: approvals.id })
      .from(approvals)
      .where(and(eq(approvals.runId, runId), eq(approvals.nodeId, nodeId), eq(approvals.status, "pending")))
      .orderBy(desc(approvals.createdAt))
      .limit(1);
    if (row) {
      const token = `approval:${row.id}`;
      if (token === excludeToken) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      await waitForHook(handle, { token, timeout: Math.max(1, deadline - Date.now()) });
      return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("等待人工确认超时");
}
