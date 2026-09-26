// 调度触发入口：Vercel Cron（vercel.json 每日兜底）与外部 pinger（分钟级）都打这里。
// 原子抢占 = 单条 UPDATE（lease 守卫）；领取即推进 next_run_at（错过不补跑）；
// 一次性任务到期先开跑这一次再归档；spec 损坏直接归档不开跑；start 失败计数 3 次停跑。
import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { ScheduleSpec } from "@/contracts/schedule";
import { schedules } from "@/db/schema";
import { db } from "@/lib/db";
import { nextOccurrence } from "@/server/domain/schedule-spec";
import { startRunCore } from "@/server/services/start-run-core";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "未授权的调用" }, { status: 401 });
  }
  const claimed = await db
    .update(schedules)
    .set({ leaseUntil: sql`now() + interval '60 seconds'`, updatedAt: new Date() })
    .where(
      and(
        eq(schedules.status, "active"),
        isNull(schedules.archivedAt),
        lte(schedules.nextRunAt, new Date()),
        or(isNull(schedules.leaseUntil), lt(schedules.leaseUntil, new Date())),
      ),
    )
    .returning();
  let started = 0;
  let failed = 0;
  for (const schedule of claimed) {
    const occurrenceKey = schedule.nextRunAt.toISOString();
    const parsedSpec = ScheduleSpec.safeParse(schedule.spec);
    if (!parsedSpec.success) {
      await db
        .update(schedules)
        .set({ status: "archived", archivedAt: new Date(), lastError: "定时规格不完整，已停止", leaseUntil: null, updatedAt: new Date() })
        .where(eq(schedules.id, schedule.id));
      continue;
    }
    const next = nextOccurrence(parsedSpec.data, schedule.nextRunAt);
    // 先推进/收口再开跑：进程中断也不会对同一槽位重复开 run（runs.source_key 唯一索引兜底幂等）
    await db
      .update(schedules)
      .set(
        next
          ? { nextRunAt: next, leaseUntil: null, updatedAt: new Date() }
          : { status: "archived", archivedAt: new Date(), leaseUntil: null, updatedAt: new Date() },
      )
      .where(eq(schedules.id, schedule.id));
    const result = await startRunCore({
      agentId: schedule.agentId,
      versionId: schedule.versionId,
      input: schedule.input,
      sourceType: "schedule",
      sourceKey: `${schedule.id}:${occurrenceKey}`,
    });
    if (result.ok) {
      started += 1;
      await db
        .update(schedules)
        .set({ lastRunId: result.runId, lastError: null, consecutiveFailures: 0, updatedAt: new Date() })
        .where(eq(schedules.id, schedule.id));
    } else {
      failed += 1;
      const failures = schedule.consecutiveFailures + 1;
      // 一次性任务失败时保持归档，不复活成 active（错误记录在 lastError 供页面查看）
      await db
        .update(schedules)
        .set({
          consecutiveFailures: failures,
          lastError: result.error,
          ...(next ? { status: failures >= 3 ? "error" : schedule.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schedules.id, schedule.id));
    }
  }
  return Response.json({ ok: true, claimed: claimed.length, started, failed });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
