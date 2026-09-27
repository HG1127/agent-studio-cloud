// 调度触发入口：Vercel Cron（vercel.json 每日兜底）与外部 pinger（分钟级）都打这里。
// 原子抢占 = 事务内按到期顺序 SKIP LOCKED 分批领取；启动前推进 next_run_at（错过不补跑）；
// 一次性任务到期先开跑这一次再归档；spec 损坏直接归档不开跑；start 失败计数 3 次停跑。
import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { ScheduleSpec } from "@/contracts/schedule";
import { schedules } from "@/db/schema";
import { db } from "@/lib/db";
import { nextOccurrenceAfterDue } from "@/server/domain/schedule-spec";
import { startRunCore } from "@/server/services/start-run-core";

export const dynamic = "force-dynamic";
export const MAX_SCHEDULES_PER_TICK = 25;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function claimDueSchedules() {
  const now = new Date();
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(
        eq(schedules.status, "active"),
        isNull(schedules.archivedAt),
        lte(schedules.nextRunAt, now),
        or(isNull(schedules.leaseUntil), lt(schedules.leaseUntil, now)),
      ))
      .orderBy(asc(schedules.nextRunAt), asc(schedules.createdAt))
      .limit(MAX_SCHEDULES_PER_TICK)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    // 租约要用毫秒精度写入，确保返回的 Date 可用于后续条件更新。
    return tx
      .update(schedules)
      .set({ leaseUntil: new Date(now.getTime() + 60_000), updatedAt: now })
      .where(inArray(schedules.id, due.map((schedule) => schedule.id)))
      .returning();
  });
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "未授权的调用" }, { status: 401 });
  }
  const claimed = await claimDueSchedules();
  let started = 0;
  let failed = 0;
  for (const schedule of claimed) {
    const claimedLease = schedule.leaseUntil;
    if (!claimedLease) continue;
    const stillClaimed = and(
      eq(schedules.id, schedule.id),
      eq(schedules.workspaceId, schedule.workspaceId),
      eq(schedules.status, "active"),
      isNull(schedules.archivedAt),
      eq(schedules.nextRunAt, schedule.nextRunAt),
      eq(schedules.leaseUntil, claimedLease),
    );
    const occurrenceKey = schedule.nextRunAt.toISOString();
    const parsedSpec = ScheduleSpec.safeParse(schedule.spec);
    if (!parsedSpec.success) {
      await db
        .update(schedules)
        .set({ status: "archived", archivedAt: new Date(), lastError: "定时规格不完整，已停止", leaseUntil: null, updatedAt: new Date() })
        .where(stillClaimed);
      continue;
    }
    const next = nextOccurrenceAfterDue(parsedSpec.data, schedule.nextRunAt, new Date());
    // 先推进/收口再开跑：进程中断也不会对同一槽位重复开 run（runs.source_key 唯一索引兜底幂等）
    const advanced = await db
      .update(schedules)
      .set(
        next
          ? { nextRunAt: next, updatedAt: new Date() }
          : { status: "archived", archivedAt: new Date(), updatedAt: new Date() },
      )
      .where(stillClaimed)
      .returning({ id: schedules.id });
    if (advanced.length === 0) continue;
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
        .set({ lastRunId: result.runId, lastError: null, consecutiveFailures: 0, leaseUntil: null, updatedAt: new Date() })
        .where(and(
          eq(schedules.id, schedule.id),
          eq(schedules.workspaceId, schedule.workspaceId),
          eq(schedules.leaseUntil, claimedLease),
        ));
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
          leaseUntil: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schedules.id, schedule.id),
          eq(schedules.workspaceId, schedule.workspaceId),
          eq(schedules.leaseUntil, claimedLease),
        ));
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
