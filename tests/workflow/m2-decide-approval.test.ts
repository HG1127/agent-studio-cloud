import { eq } from "drizzle-orm";
import { vi, describe, expect, it } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("workflow/api", () => ({ resumeHook: async () => undefined }));

import { approvals, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { decideApprovalAction } from "@/server/actions/decide-approval";

const RUN_ID = "00000000-0000-4000-8000-0000000000e5";
const APPROVAL_ID = "00000000-0000-4000-8000-0000000000e6";
const AGENT_ID = "00000000-0000-4000-8000-0000000000e7";
const VERSION_ID = "00000000-0000-4000-8000-0000000000e8";

describe("审批决定的原子性", () => {
  it("二次提交返回已处理且不再改动确认行", async () => {
    await db.insert(runs).values({
      id: RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: AGENT_ID, versionId: VERSION_ID, status: "waiting_approval", input: {},
    });
    await db.insert(approvals).values({
      id: APPROVAL_ID, runId: RUN_ID, workspaceId: DEMO_WORKSPACE_ID,
      nodeId: "confirm", nodeTitle: "负责人确认处理方案", status: "pending",
      role: "业务负责人", reason: "确认处理方案后流程才会继续",
    });
    try {
      const first = await decideApprovalAction(RUN_ID, APPROVAL_ID, { decision: "approved", note: "同意执行" });
      expect(first.ok).toBe(true);
      const [afterFirst] = await db.select().from(approvals).where(eq(approvals.id, APPROVAL_ID)).limit(1);
      expect(afterFirst?.status).toBe("approved");
      expect(afterFirst?.decidedAt).not.toBeNull();

      const second = await decideApprovalAction(RUN_ID, APPROVAL_ID, { decision: "rejected", note: "反悔" });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error).toContain("已经处理过");
      const [afterSecond] = await db.select().from(approvals).where(eq(approvals.id, APPROVAL_ID)).limit(1);
      expect(afterSecond?.status).toBe("approved");
      expect(afterSecond?.note).toBe("同意执行");
      expect(afterSecond?.decidedAt?.getTime()).toBe(afterFirst?.decidedAt?.getTime());
    } finally {
      await db.delete(approvals).where(eq(approvals.runId, RUN_ID));
      await db.delete(runs).where(eq(runs.id, RUN_ID));
    }
  }, 240_000);
});
