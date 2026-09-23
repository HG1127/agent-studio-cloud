import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { concurrentTraceWorkflow } from "./concurrent-trace.workflow";
import { runs, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";

const RUN_ID = "00000000-0000-4000-8000-0000000000e9";
const VERSION_ID = "00000000-0000-4000-8000-0000000000ea";

// 红灯阶段唯一索引未建时竞态会留下重号行，afterAll 必须按 runId 全清，否则迁移建唯一索引会失败
afterAll(async () => {
  await db.delete(traceEvents).where(eq(traceEvents.runId, RUN_ID));
  await db.delete(runs).where(eq(runs.id, RUN_ID));
});

describe("轨迹序号并发安全", () => {
  it("并发 appendTrace 的 seq 严格唯一且从 1 连续", async () => {
    // 先清残留：上一轮异常退出（如红灯阶段）可能留下未清理的 run/trace 行
    await db.delete(traceEvents).where(eq(traceEvents.runId, RUN_ID));
    await db.delete(runs).where(eq(runs.id, RUN_ID));
    await db.insert(runs).values({
      id: RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: VERSION_ID, versionId: VERSION_ID, status: "running", input: {},
    });
    const handle = await start(concurrentTraceWorkflow, [RUN_ID]);
    await handle.returnValue;
    const rows = await db
      .select({ seq: traceEvents.seq })
      .from(traceEvents)
      .where(eq(traceEvents.runId, RUN_ID))
      .orderBy(asc(traceEvents.seq));
    const seqs = rows.map((r) => r.seq);
    expect(new Set(seqs).size).toBe(seqs.length); // 无重复
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1)); // 从 1 连续
  }, 240_000);
});
